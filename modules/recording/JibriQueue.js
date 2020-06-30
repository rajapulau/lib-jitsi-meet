/* global $ */

import EventEmitter from 'events';
import { getLogger } from 'jitsi-meet-logger';
import { $iq, Strophe } from 'strophe.js';

const logger = getLogger(__filename);

/**
 * A static counter of the JibriQueue instances used to generate a unique ID for the JibriQueue instances.
 */
let id = 0;

/**
 * Represents a jibri queue.
 */
export default class JibriQueue extends EventEmitter {
    /**
     * Initializes a new JibriQueue instance.
     *
     * @param {Object} options
     * @param {string} options.jibriQueueJID - The JID of the jibri queue.
     * @param {XmppConnection} options.connection - The XMPPConnection instance to use.
     * @param {string} options.roomJID - The JID of the MUC related to the current conference.
     *
     * @constructor
     */
    constructor(options = {}) {
        super();
        const { connection, jibriQueueJID, roomJID } = options;

        this._id = id++;
        this._metrics = {};
        this._hasJoined = false;
        this._connection = connection;
        this._jibriQueueJID = jibriQueueJID;
        this._roomJID = roomJID;
        this._onIQ = this._onIQ.bind(this);
        this._connectionHandlerRef = this._connection.addHandler(this._onIQ, 'http://jitsi.org/protocol/jibri-queue',
            'iq', 'set', null, this._jibriQueueJID, { matchBareFromJid: true });
    }

    /**
     * Returns the unique ID of the queue instance.
     *
     * @returns {number} - The ID of the queue.
     */
    get id() {
        return this._id;
    }

    /**
     * Joins the jibri queue.
     *
     * @returns {Promise}
     */
    join() {
        if (this._hasJoined) {
            return Promise.reject(new Error('The queue is already joined!'));
        }

        return new Promise((resolve, reject) => {
            this._connection.sendIQ(
                $iq({
                    to: this._jibriQueueJID, // 'jibri-queue1@auth.hristo.jitsi.net',
                    type: 'set'
                })
                .c('jibri-queue', {
                    xmlns: 'http://jitsi.org/protocol/jibri-queue',
                    action: 'join',
                    room: this._roomJID
                })
                .up(), () => {
                    this._hasJoined = true;
                    logger.debug('Successfully joined the jibri queue!');
                }, error => {
                    logger.error(`Error joining the jibri queue - ${error}!`);
                    reject(error);
                }
            );
        });
    }

    /**
     * Handler for incoming IQ packets.
     *
     * @param {Element} iq - The IQ.
     * @returns {boolean}
     */
    _onIQ(iq) {
        if (!this._hasJoined) {
            return;
        }

        const jibriQueueNodes = $(iq).find('jibri-queue');
        const from = iq.getAttribute('from');

        if (from !== this._jibriQueueJID || jibriQueueNodes.length === 0) {
            // This shouldn't happen!

            return;
        }

        const jibriQueue = jibriQueueNodes[0];
        const action = jibriQueue.getAttribute('action');
        const value = jibriQueue.getAttribute('value');
        const ack = $iq({ type: 'result',
            to: from,
            id: iq.getAttribute('id')
        });

        switch (action) {
        case 'info': {
            let updated = false;

            for (const child of Array.from(jibriQueue.children)) {
                switch (child.tagName) {
                case 'position': {
                    const position = Strophe.getText(child);

                    if (position !== this._metrics.position) {
                        this._metrics.position = position;
                        updated = true;
                    }
                    break;
                }
                case 'time': {
                    const estimatedTimeLeft = Strophe.getText(child);

                    if (estimatedTimeLeft !== this._metrics.estimatedTimeLeft) {
                        this._metrics.estimatedTimeLeft = estimatedTimeLeft;
                        updated = true;
                    }
                    break;
                }
                }
            }

            if (updated) {
                this.emit('metrics', this._metrics);

                logger.debug(`JibriQueue info update: ${JSON.stringify(this._metrics)}}`);
            }

            break;
        }
        case 'token':
            this.emit('token', value);
            logger.debug('JibriQueue: token received.');
            break;

        default:
            ack.attrs({ type: 'error' });
            ack.c('error', { type: 'cancel' })
                .c('service-unavailable', {
                    xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas'
                })
                .up();
        }

        this._connection.send(ack);

        return true;
    }

    /**
     * Leave the queue.
     *
     * @returns {Promise}
     */
    leave() {
        if (!this._hasJoined) {
            return Promise.reject(new Error('There\'s no queue to leave!'));
        }

        return new Promise((resolve, reject) => {
            this._connection.sendIQ(
                $iq({
                    to: this._jibriQueueJID,
                    type: 'set'
                })
                .c('jibri-queue', {
                    'xmlns': 'http://jitsi.org/protocol/jibri-queue',
                    'action': 'leave'
                })
                .up(), () => {
                    logger.debug('Successfully left the jibri queue!');
                }, error => {
                    logger.error(`Error leaving the jibri queue - ${error}!`);

                    reject(error);
                }
            );
        });
    }

    /**
     * Disposes the allocated resources.
     */
    dispose() {
        this._connection.deleteHandler(this._connectionHandlerRef);
        this.removeAllListeners();
    }
}
