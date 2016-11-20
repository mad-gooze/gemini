'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const proxyquire = require('proxyquire');
const EventEmitter = require('events').EventEmitter;
const globExtra = require('glob-extra');
const SetCollection = require('gemini-core/lib/test-reader/set-collection');
const SetBuilder = require('gemini-core/lib/test-reader/set-builder');
const TestSet = require('gemini-core/lib/test-reader/test-set');
const CoreError = require('gemini-core/lib/errors/core-error');
const GeminiError = require('lib/errors/gemini-error');

const utils = require('lib/utils');

describe('test-reader', () => {
    const sandbox = sinon.sandbox.create();
    const testsApi = sandbox.stub();
    const validateUnknownSets = sandbox.stub();

    let readTests;

    const mkConfigStub = (opts) => {
        opts = opts || {};

        return _.defaultsDeep(opts, {
            getBrowserIds: sandbox.stub().returns(opts.browsers || []),
            system: {
                projectRoot: '/root'
            }
        });
    };

    const readTests_ = (opts) => {
        const REQUIRED_OPTS = {
            system: {
                projectRoot: '/root'
            }
        };

        opts = _.defaults(opts || {}, {
            sets: {},
            paths: [],
            config: {},
            emitter: new EventEmitter()
        });
        opts.config = _.defaultsDeep(opts.config, REQUIRED_OPTS);

        return readTests({paths: opts.paths, sets: opts.sets}, opts.config, opts.emitter);
    };

    const mkSetStub = (opts) => TestSet.create(opts);

    beforeEach(() => {
        sandbox.stub(utils, 'requireWithNoCache');
        sandbox.stub(globExtra, 'expandPaths').returns(Promise.resolve([]));
        sandbox.stub(SetBuilder.prototype, 'useFiles').returnsThis();
        sandbox.stub(SetBuilder.prototype, 'useSets').returnsThis();

        const setCollection = sinon.createStubInstance(SetCollection);
        sandbox.stub(SetBuilder.prototype, 'build').returns(Promise.resolve(setCollection));

        readTests = proxyquire('lib/test-reader', {
            './tests-api': testsApi,
            'gemini-core/lib/utils/unknown-sets-validator': validateUnknownSets
        });
    });

    afterEach(() => {
        sandbox.restore();
        testsApi.reset();
    });

    describe('read tests', () => {
        it('should create set-builder using passed options and browsers from config', () => {
            const create = sandbox.spy(SetBuilder, 'create');
            const opts = {
                config: mkConfigStub({
                    sets: {
                        all: {}
                    },
                    browsers: ['bro1', 'bro2']
                })
            };

            return readTests_(opts)
                .then(() => assert.calledWith(create, {all: {}}, ['bro1', 'bro2']));
        });

        it('should use gemini folder if sets are not specified in config and paths are not passed', () => {
            const config = mkConfigStub({
                system: {
                    projectRoot: '/project/root'
                }
            });

            return readTests_({config})
                .then(() => assert.calledWith(SetBuilder.prototype.useFiles, ['/project/root/gemini']));
        });

        it('should use paths passed from cli', () => {
            return readTests_({paths: ['some/path'], config: mkConfigStub()})
                .then(() => assert.calledWith(SetBuilder.prototype.useFiles, ['some/path']));
        });

        it('should validate unknown sets', () => {
            const config = mkConfigStub({
                sets: {
                    set1: {}
                }
            });

            return readTests_({sets: ['set2'], config})
                .then(() => assert.calledWith(validateUnknownSets, ['set1'], ['set2']));
        });

        it('should be rejected with gemini-error, if core error was thrown', () => {
            SetBuilder.prototype.build.returns(Promise.reject(new CoreError()));

            return assert.isRejected(readTests_({config: mkConfigStub()}), GeminiError);
        });

        it('should be rejected with native error, if native error was thrown', () => {
            SetBuilder.prototype.build.returns(Promise.reject(new CoreError()));

            return assert.isRejected(readTests_({config: mkConfigStub()}), Error);
        });
    });

    describe('global "gemini" variable', () => {
        let gemini;

        beforeEach(() => {
            const sets = {
                all: mkSetStub({
                    files: ['some/files', 'other/files/']
                })
            };
            const setCollection = SetCollection.create(sets);
            SetBuilder.prototype.build.returns(Promise.resolve(setCollection));

            utils.requireWithNoCache.restore();
        });

        it('should use global "gemini" variable', () => {
            sandbox.stub(utils, 'requireWithNoCache', () => gemini = global.gemini);
            const api = {suite: 'api'};

            testsApi.returns(api);

            return readTests_({config: mkConfigStub()})
                .then(() => assert.deepEqual(gemini, api));
        });

        it('should rewrite global "gemini" variable for each file', () => {
            let globalGemini = [];

            globExtra.expandPaths.returns(Promise.resolve(['/some/path/file1.js', '/some/path/file2.js']));

            testsApi
                .onFirstCall().returns({suite: 'apiInstance'})
                .onSecondCall().returns({suite: 'anotherApiInstance'});

            sandbox.stub(utils, 'requireWithNoCache', () => {
                globalGemini.push(global.gemini.suite);
            });

            return readTests_({config: mkConfigStub()})
                .then(() => assert.deepEqual(globalGemini, ['apiInstance', 'anotherApiInstance']));
        });

        it('should delete global "gemini" variable after test reading', () => {
            testsApi.returns({suite: 'api'});
            globExtra.expandPaths.returns(Promise.resolve(['some-test.js']));
            sandbox.stub(utils, 'requireWithNoCache');

            return readTests_({config: mkConfigStub()}).then(() => assert.notProperty(global, 'gemini'));
        });
    });

    describe('events', () => {
        beforeEach(() => {
            const sets = {
                all: mkSetStub({
                    files: ['/some/path/file.js']
                })
            };
            const setCollection = SetCollection.create(sets);
            SetBuilder.prototype.build.returns(Promise.resolve(setCollection));
        });

        it('should emit "beforeFileRead" before reading each file', () => {
            const beforeReadSpy = sandbox.spy().named('OnBeforeFileRead');

            const emitter = new EventEmitter();
            emitter.on('beforeFileRead', beforeReadSpy);

            return readTests_({config: mkConfigStub(), emitter})
                .then(() => {
                    assert.calledWithExactly(beforeReadSpy, '/some/path/file.js');
                    assert.callOrder(beforeReadSpy, utils.requireWithNoCache);
                });
        });

        it('should emit "afterFileRead" after reading each file', () => {
            const afterReadSpy = sandbox.spy().named('OnAfterFileRead');

            const emitter = new EventEmitter();
            emitter.on('afterFileRead', afterReadSpy);

            return readTests_({config: mkConfigStub(), emitter})
                .then(() => {
                    assert.calledWithExactly(afterReadSpy, '/some/path/file.js');
                    assert.callOrder(utils.requireWithNoCache, afterReadSpy);
                });
        });
    });
});
