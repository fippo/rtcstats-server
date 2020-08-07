const EventEmitter = require('events');
const { Worker } = require('worker_threads');
const uuid = require('uuid');

const logger = require('../logging');
const { ResponseType } = require('../utils/utils');


const WorkerStatus = Object.freeze({
    IDLE: 'IDLE',
    STOPPED: 'STOPPED',
    RUNNING: 'RUNNING',
});

/**
 * The WorkerPool implementation will attempt to always keep the set number of worker running, that means in case of
 * an error or a exit due to something happening inside the worker script, it will spawn a new one.
 * However when the processes exits from the main thread or SIGKILL/SIGTERM it will shutdown as expected.
 */
class WorkerPool extends EventEmitter {
    constructor(workerScriptPath, poolSize) {
        super();

        this.taskQueue = [];
        this.workerPool = [];
        this.workerScriptPath = workerScriptPath;
        this.poolSize = poolSize;

        for (let i = 0; i < poolSize; ++i) {
            this._addWorkerToPool();
        }
    }

    _addWorkerToPool() {
        const workerMeta = this._createWorker(uuid.v4());
        this.workerPool.push(workerMeta);
        this._workerPoolIntrospect();

        return workerMeta;
    }

    _createWorker(workerID) {
        const workerInstance = new Worker(this.workerScriptPath, {
            workerData: { workerID },
            resourceLimits: { maxOldGenerationSizeMb: 4096, maxYoungGenerationSizeMb: 1024 },
        });
        const workerMeta = { workerID, worker: workerInstance, status: WorkerStatus.IDLE };

        logger.info('[WorkerPool] Created worker %j', workerMeta);

        workerInstance.on('message', (message) => {

            if (message.type === ResponseType.STATE_UPDATE) {
                if (message.body) {
                    workerMeta.currentTaskMeta = message.body;
                }

                return;
            }

            this.emit(message.type, message.body);

            if (message.type === ResponseType.ERROR || message.type === ResponseType.DONE) {
                this._processNextTask(workerMeta);
            }
        });

        // Uncaught error thrown in the worker script, a exit event will follow so we just log the error.
        workerInstance.on('error', (error) => {
            logger.error('[WorkerPool] Worker %j with error %o: ', workerMeta, error);
            // Check if there was an ongoing operation during the worker crash and notify the client.
            if (workerMeta.currentTaskMeta) {
                this.emit(ResponseType.ERROR, {...workerMeta.currentTaskMeta, error});
            }
        });

        workerInstance.on('exit', (exitCode) => {
            logger.info('[WorkerPool] Worker %j exited with code %d.', workerMeta, exitCode);
            workerMeta.status = WorkerStatus.STOPPED;

            // Remove current worker from pool as it's no longer usable.
            this._removeWorkerFromPool(workerMeta);

            // Bring the worker pool back to maximum capacity. When the main thread is trying to exit
            // this won't work as the creation is queued via a setTimeout, so an infinite loop shouldn't
            // happen.
            this._regenerateWorkerToPool();
        });

        return workerMeta;
    }

    _workerPoolIntrospect() {
        const workerPoolInfo = this.workerPool.map((workerMeta) => {
            return { uuid: workerMeta.workerID, status: workerMeta.status };
        });

        logger.info('[WorkerPool] Worker pool introspect: %j ', workerPoolInfo);
    }

    _removeWorkerFromPool(worker) {
        logger.info('[WorkerPool] Removing worker from pool: %j', worker);
        const workerIndex = this.workerPool.indexOf(worker);
        if (workerIndex > -1) {
            this.workerPool.splice(workerIndex, 1);
        }
        this._workerPoolIntrospect();
    }

    _processTask(workerMeta, task) {
        logger.info(`[WorkerPool] Processing task %j, current queue size %d`, task, this.taskQueue.length);
        workerMeta.worker.postMessage(task);
        workerMeta.status = WorkerStatus.RUNNING;
    }

    _processNextTask(workerMeta) {
        if (this.taskQueue.length === 0) {
            workerMeta.status = WorkerStatus.IDLE;
        } else {
            this._processTask(workerMeta, this.taskQueue.shift());
        }
    }

    _regenerateWorkerToPool() {
        // timeout is required here so the regeneration process doesn't enter an infinite loop
        // when node.js is attempting to shutdown.
        setTimeout(() => {
            if (this.workerPool.length < this.poolSize) {
                const workerMeta = this._addWorkerToPool();
                this._processNextTask(workerMeta);
            } else {
                logger.warn('[WorkerPool] Can not add additional worker, pool is already at max capacity!');
            }
        }, 2000);
    }

    _getIdleWorkers() {
        return this.workerPool.filter((worker) => {
            return worker.status === WorkerStatus.IDLE;
        });
    }

    addTask(task) {
        const idleWorkers = this._getIdleWorkers();

        if (idleWorkers.length > 0) {
            this._processTask(idleWorkers[0], task);
        } else {
            this.taskQueue.push(task);
            logger.info(`[WorkerPool] There are no IDLE workers queueing, current queue size <${this.taskQueue.length}>`);
        }
    }

    getTaskQueueSize() {
        return this.taskQueue.length;
    }
}

module.exports = WorkerPool;
