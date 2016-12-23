'use strict';

const SuiteRunner = require('./suite-runner');
const RegularSuiteRunner = require('./regular-suite-runner');
const SuiteCollection = require('../../suite-collection');
const Events = require('../../constants/events');
const NoRefImageError = require('../../errors/no-ref-image-error');
const _ = require('lodash');

module.exports = class InsistentSuiteRunner extends SuiteRunner {
    static create(suite, browserAgent, browserConfig) {
        return new InsistentSuiteRunner(suite, browserAgent, browserConfig);
    }

    constructor(suite, browserAgent, browserConfig) {
        super(suite, browserAgent);

        this._retries = browserConfig.retry;
        this._retriesPerformed = 0;
    }

    _doRun(stateProcessor) {
        this._suiteRunner = this._initSuiteRunner();
        this._statesToRetry = [];

        return this._suiteRunner.run(stateProcessor)
            .then(() => this._retry(stateProcessor));
    }

    _initSuiteRunner() {
        this._disablePassedStates(this._suite);

        const runner = RegularSuiteRunner.create(this._suite, this._browserAgent);

        this._handleEvent(runner, Events.ERROR, (e) => e instanceof NoRefImageError);
        this._handleEvent(runner, Events.TEST_RESULT, (r) => r.equal);

        this.passthroughEvent(runner, [
            Events.BEGIN_STATE,
            Events.SKIP_STATE,
            Events.END_STATE,
            Events.CAPTURE,
            Events.UPDATE_RESULT,
            Events.WARNING
        ]);

        return runner;
    }

    _handleEvent(runner, event, shouldPassthrough) {
        runner.on(event, (data) => {
            if (shouldPassthrough(data) || !this._submitForRetry(data)) {
                this._emit(event, data);
            }
        });
    }

    _retry(stateProcessor) {
        if (_.isEmpty(this._statesToRetry) || this._cancelled) {
            return;
        }

        ++this._retriesPerformed;
        return this._doRun(stateProcessor);
    }

    _disablePassedStates(suite) {
        if (_.isEmpty(this._statesToRetry)) {
            return;
        }

        const collection = new SuiteCollection([suite]).disableAll();
        const browser = this._browserAgent.browserId;
        this._statesToRetry.forEach((state) => collection.enable(suite, {state, browser}));
    }

    _submitForRetry(e) {
        const retriesLeft = this._retries - this._retriesPerformed;
        if (!retriesLeft) {
            return false;
        }

        this._statesToRetry = this._statesToRetry.concat(e.state.name);

        this._emit(Events.RETRY, _.extend(e, {attempt: this._retriesPerformed, retriesLeft}));
        return true;
    }
};
