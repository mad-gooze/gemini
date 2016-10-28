'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const proxyquire = require('proxyquire');
const EventEmitter = require('events').EventEmitter;
const globExtra = require('glob-extra');
const SetCollection = require('gemini-core/lib/test-reader/set-collection');
const CoreError = require('gemini-core/lib/errors/core-error');
const GeminiError = require('lib/errors/gemini-error');

const utils = require('lib/utils');

describe('test-reader', () => {
    const sandbox = sinon.sandbox.create();
    const testsApi = sandbox.stub();
    let setCollection = sinon.createStubInstance(SetCollection);

    let readTests;

    const readTests_ = (opts) => {
        const REQUIRED_OPTS = {
            system: {
                projectRoot: '/root'
            }
        };

        opts = _.defaults(opts || {}, {
            paths: [],
            config: {},
            emitter: new EventEmitter()
        });

        opts.config = _.defaultsDeep(opts.config, REQUIRED_OPTS);

        return readTests({paths: opts.paths, sets: opts.sets}, opts.config, opts.emitter);
    };

    beforeEach(() => {
        sandbox.stub(utils, 'requireWithNoCache');
        sandbox.stub(globExtra, 'expandPaths').returns(Promise.resolve([]));
        sandbox.stub(SetCollection.prototype, 'filterFiles');
        sandbox.stub(SetCollection, 'create');

        readTests = proxyquire('lib/test-reader', {
            './tests-api': testsApi
        });
    });

    afterEach(() => {
        sandbox.restore();
        testsApi.reset();
    });

    describe('read tests', () => {
        beforeEach(() => {
            SetCollection.create.returns(setCollection);
        });

        it('should create set-collection with passed options and config', () => {
            const opts = {
                paths: ['some/path'],
                sets: {
                    all: {}
                },
                config: {
                    system: {
                        projectRoot: '/project/root'
                    }
                }
            };

            return readTests_(opts)
                .then(() => assert.calledWith(SetCollection.create, opts.config, {
                    paths: opts.paths,
                    sets: opts.sets
                }));
        });

        it('should use gemini folder if sets are not specified in config and paths are not passed', () => {
            const config = {
                getBrowserIds: () => []
            };

            globExtra.expandPaths.withArgs(['/root/gemini']).returns(Promise.resolve(['/root/gemini/file.js']));

            return readTests_({config})
                .then(() => assert.calledWith(setCollection.filterFiles, ['/root/gemini/file.js']));
        });

        it('should expand passed paths from cli', () => {
            return readTests_({paths: ['some/path']})
                .then(() => assert.calledWith(globExtra.expandPaths, ['some/path']));
        });

        it('should reject with gemini-error, if core error was thrown', () => {
            setCollection.filterFiles.throws(new CoreError());

            return assert.isRejected(readTests_(), GeminiError);
        });

        it('should reject with simple error, if simple error was thrown', () => {
            setCollection.filterFiles.throws(new Error());

            return assert.isRejected(readTests_(), Error);
        });
    });

    describe('global "gemini" variable', () => {
        let gemini;
        let config;

        beforeEach(() => {
            config = {
                sets: {
                    set: {
                        files: ['some/files']
                    }
                },
                getBrowserIds: () => []
            };

            setCollection = new SetCollection({
                set: {
                    files: ['some/files', 'other/files']
                }
            });
            SetCollection.create.returns(setCollection);

            utils.requireWithNoCache.restore();
        });

        it('should use global "gemini" variable', () => {
            sandbox.stub(utils, 'requireWithNoCache', () => gemini = global.gemini);
            const api = {suite: 'api'};

            testsApi.returns(api);

            return readTests_({config})
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

            return readTests_({config})
                .then(() => assert.deepEqual(globalGemini, ['apiInstance', 'anotherApiInstance']));
        });

        it('should delete global "gemini" variable after test reading', () => {
            testsApi.returns({suite: 'api'});
            globExtra.expandPaths.returns(Promise.resolve(['some-test.js']));
            sandbox.stub(utils, 'requireWithNoCache');

            return readTests_({config}).then(() => assert.notProperty(global, 'gemini'));
        });
    });

    describe('events', () => {
        beforeEach(() => {
            setCollection = new SetCollection({
                set: {
                    files: ['/some/path/file.js']
                }
            });
            SetCollection.create.returns(setCollection);
        });

        it('should emit "beforeFileRead" before reading each file', () => {
            const beforeReadSpy = sandbox.spy().named('OnBeforeFileRead');

            const emitter = new EventEmitter();
            emitter.on('beforeFileRead', beforeReadSpy);

            return readTests_({emitter})
                .then(() => {
                    assert.calledWithExactly(beforeReadSpy, '/some/path/file.js');
                    assert.callOrder(beforeReadSpy, utils.requireWithNoCache);
                });
        });

        it('should emit "afterFileRead" after reading each file', () => {
            const afterReadSpy = sandbox.spy().named('OnAfterFileRead');

            const emitter = new EventEmitter();
            emitter.on('afterFileRead', afterReadSpy);

            return readTests_({emitter})
                .then(() => {
                    assert.calledWithExactly(afterReadSpy, '/some/path/file.js');
                    assert.callOrder(utils.requireWithNoCache, afterReadSpy);
                });
        });
    });
});
