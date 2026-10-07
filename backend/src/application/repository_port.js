'use strict';

/**
 * @typedef {Object} RepositoryPort
 * @property {function(): Promise<Array<{id: string, config: Object}>>} loadJunctions
 * @property {function(string): Promise<{state: Object, version: number}|null>} loadState
 * @property {function(string, Object): Promise<void>} createJunction
 * @property {function(string): Promise<boolean>} isProcessed
 * @property {function(Object): Promise<void>} saveTransition - ONE TX for state, audit, queues, commands
 * @property {function(Array<Object>): Promise<void>} appendAudit - for duplicates/rejections outside state changes
 * @property {function(string, Object): Promise<Array<Object>>} getHistory
 * @property {function(string): Promise<void>} markPendingCommandsAbandoned
 * @property {function(Object): Promise<void>} logRejectedEvent
 */

module.exports = {};
