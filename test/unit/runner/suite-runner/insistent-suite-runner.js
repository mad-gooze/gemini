'use strict';

const Events = require('lib/constants/events');
const InsistentSuiteRunner = require('lib/runner/suite-runner/insistent-suite-runner');
const RegularSuiteRunner = require('lib/runner/suite-runner/regular-suite-runner');
const BrowserAgent = require('lib/runner/browser-runner/browser-agent');
const CancelledError = require('lib/errors/cancelled-error');
const NoRefImageError = require('lib/errors/no-ref-image-error');
const makeStateStub = require('../../../util').makeStateStub;
const makeSuiteStub = require('../../../util').makeSuiteStub;
const makeSuiteTree = require('../../../util').makeSuiteTree;
const Promise = require('bluebird');
const _ = require('lodash');

describe('runner/suite-runner/insistent-suite-runner', () => {
    const sandbox = sinon.sandbox.create();

    const mkBrowserConfigStub_ = (opts) => {
        return opts || {foo: 'default-bar'};
    };

    const mkBrowserAgentStub_ = (browserId) => {
        const browserAgent = new BrowserAgent();
        browserAgent.browserId = browserId || 'default-bro';
        return browserAgent;
    };

    const mkInsistentRunner_ = (opts) => {
        opts = opts || {};

        return InsistentSuiteRunner.create(
            opts.suite || makeSuiteStub({states: [makeStateStub()]}),
            opts.browserAgent || mkBrowserAgentStub_(),
            opts.browserConfig || mkBrowserConfigStub_({retry: 0})
        );
    };

    const stubWrappedRun_ = (scenario) => {
        RegularSuiteRunner.prototype.run.restore();
        sandbox.stub(RegularSuiteRunner.prototype, 'run', function() {
            return Promise.resolve(scenario(this));
        });
    };

    beforeEach(() => {
        sandbox.stub(RegularSuiteRunner.prototype, 'run').returns(Promise.resolve());
    });

    afterEach(() => sandbox.restore());

    it('should create regular suite runner', () => {
        const suite = makeSuiteStub();
        const browserAgent = mkBrowserAgentStub_();
        const browserConfig = mkBrowserConfigStub_();

        sandbox.spy(RegularSuiteRunner, 'create');

        return InsistentSuiteRunner.create(suite, browserAgent, browserConfig)
            .run()
            .then(() => {
                assert.calledOnce(RegularSuiteRunner.create);
                assert.calledWith(RegularSuiteRunner.create, suite, browserAgent);
            });
    });

    [
        Events.BEGIN_STATE,
        Events.SKIP_STATE,
        Events.END_STATE,
        Events.TEST_RESULT,
        Events.CAPTURE,
        Events.UPDATE_RESULT,
        Events.WARNING
    ].forEach((stateEvent) => it(`should passthrough ${stateEvent} state`, () => {
        stubWrappedRun_((runner) => runner.emit(stateEvent, {foo: 'bar'}));
        const handler = sinon.spy().named(stateEvent + 'Handler');

        return mkInsistentRunner_()
            .on(stateEvent, handler)
            .run()
            .then(() => {
                assert.calledOnce(handler);
                assert.calledWithMatch(handler, {foo: 'bar'});
            });
    }));

    [
        Events.BEGIN_SUITE,
        Events.END_SUITE
    ].forEach((suiteEvent) => it(`should not passthrough ${suiteEvent}`, () => {
        stubWrappedRun_((runner) => runner.emit(suiteEvent, {foo: 'bar'}));
        const handler = sinon.spy().named(suiteEvent + 'Handler');

        return mkInsistentRunner_()
            .on(suiteEvent, handler)
            .run()
            .then(() => assert.neverCalledWithMatch(handler, {foo: 'bar'}));
    }));

    it('should emit suite begin/end events', () => {
        const onBeginSuite = sinon.spy().named('onBeginSuite');
        const onEndSuite = sinon.spy().named('onEndSuite');

        return mkInsistentRunner_()
            .on(Events.BEGIN_SUITE, onBeginSuite)
            .on(Events.END_SUITE, onEndSuite)
            .run()
            .then(() => assert.callOrder(onBeginSuite, onEndSuite));
    });

    it('should run wrapped regular suite runner', () => {
        const stateProcessor = {some: 'object'};

        return mkInsistentRunner_()
            .run(stateProcessor)
            .then(() => {
                assert.calledOnce(RegularSuiteRunner.prototype.run);
                assert.calledWith(RegularSuiteRunner.prototype.run, stateProcessor);
            });
    });

    describe('run without retries', () => {
        describe('on ERROR', () => {
            it('should emit ERROR', () => {
                const onError = sinon.spy().named('onError');

                stubWrappedRun_((runner) => runner.emit(Events.ERROR, {foo: 'bar'}));

                return mkInsistentRunner_()
                    .on(Events.ERROR, onError)
                    .run()
                    .then(() => {
                        assert.calledOnce(onError);
                        assert.calledWithMatch(onError, {foo: 'bar'});
                    });
            });

            it('should not retry', () => {
                stubWrappedRun_((runner) => runner.emit(Events.ERROR, {}));

                return mkInsistentRunner_()
                    .run()
                    .then(() => assert.calledOnce(RegularSuiteRunner.prototype.run));
            });
        });

        describe('on TEST_RESULT with diff', () => {
            it('should emit same TEST_RESULT', () => {
                const onTestResult = sinon.spy().named('onTestResult');

                stubWrappedRun_((runner) => runner.emit(Events.TEST_RESULT, {equal: false}));

                return mkInsistentRunner_()
                    .on(Events.TEST_RESULT, onTestResult)
                    .run()
                    .then(() => {
                        assert.calledOnce(onTestResult);
                        assert.calledWithMatch(onTestResult, {equal: false});
                    });
            });

            it('should not retry', () => {
                stubWrappedRun_((runner) => runner.emit(Events.TEST_RESULT, {equal: false}));

                return mkInsistentRunner_()
                    .run()
                    .then(() => assert.calledOnce(RegularSuiteRunner.prototype.run));
            });
        });
    });

    describe('run with retries', () => {
        const mkRunnerWithRetries_ = (opts) => {
            return mkInsistentRunner_(_.extend(opts || {}, {
                browserConfig: mkBrowserConfigStub_({retry: 1})
            }));
        };

        describe('on ERROR', () => {
            it('should emit RETRY instead of ERROR', () => {
                const suite = makeSuiteStub();
                const state = makeStateStub(suite);

                let count = 0;
                stubWrappedRun_((runner) => {
                    if (count++ === 0) { // only first time
                        runner.emit(Events.ERROR, {foo: 'bar', state});
                    }
                });

                const browserAgent = mkBrowserAgentStub_('bro');
                const browserConfig = mkBrowserConfigStub_({retry: 3});
                const onError = sinon.spy().named('onError');
                const onRetry = sinon.spy().named('onRetry');

                return mkInsistentRunner_({suite, browserAgent, browserConfig})
                    .on(Events.ERROR, onError)
                    .on(Events.RETRY, onRetry)
                    .run()
                    .then(() => {
                        assert.notCalled(onError);

                        assert.calledOnce(onRetry);
                        assert.calledWith(onRetry, {
                            foo: 'bar',
                            suite,
                            state,
                            browserId: 'bro',
                            attempt: 0,
                            retriesLeft: 3
                        });
                    });
            });

            it('should retry as much times as specified in browserConfig', () => {
                stubWrappedRun_((runner) => runner.emit(Events.ERROR, {state: makeStateStub()}));
                const browserConfig = mkBrowserConfigStub_({retry: 2});

                return mkInsistentRunner_({browserConfig})
                    .run()
                    .then(() => assert.callCount(RegularSuiteRunner.prototype.run, 1 + 2));
            });

            it('should count few errors during run for one', () => {
                const state = makeStateStub();

                stubWrappedRun_((runner) => {
                    runner.emit(Events.ERROR, {state});
                    runner.emit(Events.ERROR, {state});
                });
                const browserConfig = mkBrowserConfigStub_({retry: 2});

                return mkInsistentRunner_({browserConfig})
                    .run()
                    .then(() => assert.callCount(RegularSuiteRunner.prototype.run, 1 + 2));
            });

            it('should not retry on NoRefImageError', () => {
                const onError = sinon.spy().named('onError');
                const onRetry = sinon.spy().named('onRetry');

                stubWrappedRun_((runner) => runner.emit(Events.ERROR, new NoRefImageError()));

                return mkRunnerWithRetries_()
                    .on(Events.ERROR, onError)
                    .on(Events.RETRY, onRetry)
                    .run()
                    .then(() => {
                        assert.notCalled(onRetry);
                        assert.calledOnce(onError);
                        assert.calledOnce(RegularSuiteRunner.prototype.run);
                    });
            });
        });

        describe('on TEST_RESULT without diff', () => {
            it('should emit same TEST_RESULT', () => {
                const onTestResult = sinon.spy().named('onTestResult');

                stubWrappedRun_((runner) => runner.emit(Events.TEST_RESULT, {equal: true}));

                return mkRunnerWithRetries_()
                    .on(Events.TEST_RESULT, onTestResult)
                    .run()
                    .then(() => {
                        assert.calledOnce(onTestResult);
                        assert.calledWithMatch(onTestResult, {equal: true});
                    });
            });

            it('should not retry', () => {
                stubWrappedRun_((runner) => runner.emit(Events.TEST_RESULT, {equal: true}));

                return mkRunnerWithRetries_()
                    .run()
                    .then(() => assert.calledOnce(RegularSuiteRunner.prototype.run));
            });
        });

        describe('on TEST_RESULT with diff', () => {
            it('should emit RETRY instead of TEST_RESULT', () => {
                const suite = makeSuiteStub();
                const state = makeStateStub(suite);

                let count = 0;
                stubWrappedRun_((runner) => {
                    if (count++ === 0) { // only first time
                        runner.emit(Events.TEST_RESULT, {equal: false, state});
                    }
                });

                const browserAgent = mkBrowserAgentStub_('bro');
                const browserConfig = mkBrowserConfigStub_({retry: 3});
                const onTestResult = sinon.spy().named('onTestResult');
                const onRetry = sinon.spy().named('onRetry');

                return mkInsistentRunner_({suite, browserAgent, browserConfig})
                    .on(Events.TEST_RESULT, onTestResult)
                    .on(Events.RETRY, onRetry)
                    .run()
                    .then(() => {
                        assert.notCalled(onTestResult);

                        assert.calledOnce(onRetry);
                        assert.calledWithMatch(onRetry, {
                            equal: false,
                            suite,
                            state,
                            browserId: 'bro',
                            attempt: 0,
                            retriesLeft: 3
                        });
                    });
            });

            it('should retry as much times as specified in browserConfig', () => {
                stubWrappedRun_((runner) => runner.emit(Events.TEST_RESULT, {equal: false, state: makeStateStub()}));
                const browserConfig = mkBrowserConfigStub_({retry: 2});

                return mkInsistentRunner_({browserConfig})
                    .run()
                    .then(() => assert.callCount(RegularSuiteRunner.prototype.run, 1 + 2));
            });

            it('should count few diffs during run for one', () => {
                const state = makeStateStub();

                stubWrappedRun_((runner) => {
                    runner.emit(Events.TEST_RESULT, {equal: false, state});
                    runner.emit(Events.TEST_RESULT, {equal: false, state});
                });
                const browserConfig = mkBrowserConfigStub_({retry: 2});

                return mkInsistentRunner_({browserConfig})
                    .run()
                    .then(() => assert.callCount(RegularSuiteRunner.prototype.run, 1 + 2));
            });

            it('should not retry on cancel after diff', () => {
                stubWrappedRun_((runner) => {
                    runner.emit(Events.TEST_RESULT, {equal: false, state: makeStateStub()});
                    return Promise.reject(new CancelledError());
                });

                return mkRunnerWithRetries_()
                    .run()
                    .catch(() => assert.calledOnce(RegularSuiteRunner.prototype.run));
            });
        });

        it('should retry only failed states', () => {
            const tree = makeSuiteTree({suite: ['1st', '2nd', '3rd']}, {browsers: ['bro']});

            stubWrappedRun_((runner) => {
                runner.emit(Events.TEST_RESULT, {state: {name: '1st'}, equal: true});
                runner.emit(Events.ERROR, {state: {name: '2nd'}});
                runner.emit(Events.TEST_RESULT, {state: {name: '3rd'}, equal: false});
            });

            sandbox.spy(RegularSuiteRunner, 'create');

            return mkRunnerWithRetries_({suite: tree.suite, browserAgent: mkBrowserAgentStub_('bro')})
                .run()
                .then(() => {
                    const retriedSuite = RegularSuiteRunner.create.secondCall.args[0];
                    assert.deepEqual(retriedSuite.states[0].browsers, []);
                    assert.deepEqual(retriedSuite.states[1].browsers, ['bro']);
                    assert.deepEqual(retriedSuite.states[2].browsers, ['bro']);
                });
        });
    });

    describe('cancel', () => {
        it('should not retry after cancel', () => {
            const browserConfig = mkBrowserConfigStub_({retry: 1});
            const insistantRunner = mkInsistentRunner_({browserConfig});

            stubWrappedRun_((runner) => {
                runner.emit(Events.TEST_RESULT, {state: makeStateStub(), equal: false});

                insistantRunner.cancel();
            });

            return insistantRunner
                .run()
                .then(() => assert.calledOnce(RegularSuiteRunner.prototype.run));
        });

        it('should not emit retry events after cancel', () => {
            const browserConfig = mkBrowserConfigStub_({retry: 1});
            const insistantRunner = mkInsistentRunner_({browserConfig});
            const onRetry = sinon.spy().named('onRetry');

            stubWrappedRun_((runner) => {
                insistantRunner.cancel();

                runner.emit(Events.TEST_RESULT, {state: makeStateStub(), equal: false});
            });

            return insistantRunner
                .on(Events.RETRY, onRetry)
                .run()
                .then(() => assert.notCalled(onRetry));
        });

        describe('should not passthrough event after cancel', () => {
            [
                Events.BEGIN_STATE,
                Events.SKIP_STATE,
                Events.END_STATE,
                Events.UPDATE_RESULT,
                Events.TEST_RESULT,
                Events.WARNING,
                Events.ERROR,
                Events.CAPTURE
            ].forEach((event) => {
                it(`${event}`, () => {
                    const browserConfig = mkBrowserConfigStub_({retry: 0});
                    const insistantRunner = mkInsistentRunner_({browserConfig});
                    const onEventHandler = sinon.spy().named(event);

                    stubWrappedRun_((runner) => {
                        insistantRunner.cancel();

                        runner.emit(event, {state: makeStateStub()});
                    });

                    return insistantRunner
                        .on(event, onEventHandler)
                        .run()
                        .then(() => assert.notCalled(onEventHandler));
                });
            });
        });
    });
});
