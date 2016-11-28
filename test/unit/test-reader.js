'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const proxyquire = require('proxyquire');
const EventEmitter = require('events').EventEmitter;
const globExtra = require('glob-extra');
const SetsBuilder = require('gemini-core').SetsBuilder;

const utils = require('lib/utils');

describe('test-reader', () => {
    const sandbox = sinon.sandbox.create();
    const testsApi = sandbox.stub();

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

    beforeEach(() => {
        sandbox.stub(utils, 'requireWithNoCache');
        sandbox.stub(globExtra, 'expandPaths').returns(Promise.resolve([]));
        sandbox.stub(SetsBuilder.prototype, 'useFiles').returnsThis();
        sandbox.stub(SetsBuilder.prototype, 'useSets').returnsThis();

        const groupByFile = () => {
            return {
                '/some/path/file1.js': [],
                '/other/path/file2.js': []
            };
        };
        sandbox.stub(SetsBuilder.prototype, 'build').returns(Promise.resolve({groupByFile}));

        readTests = proxyquire('lib/test-reader', {
            './tests-api': testsApi
        });
    });

    afterEach(() => {
        sandbox.restore();
        testsApi.reset();
    });

    describe('read tests', () => {
        it('should create set-builder using passed options and browsers from config', () => {
            const create = sandbox.spy(SetsBuilder, 'create');
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

        it('should use paths passed from cli', () => {
            return readTests_({paths: ['some/path'], config: mkConfigStub()})
                .then(() => assert.calledWith(SetsBuilder.prototype.useFiles, ['some/path']));
        });
    });

    describe('global "gemini" variable', () => {
        let gemini;

        beforeEach(() => {
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
        it('should emit "beforeFileRead" before reading each file', () => {
            const beforeReadSpy = sandbox.spy().named('OnBeforeFileRead');

            const emitter = new EventEmitter();
            emitter.on('beforeFileRead', beforeReadSpy);

            return readTests_({config: mkConfigStub(), emitter})
                .then(() => {
                    assert.calledWithExactly(beforeReadSpy, '/some/path/file1.js');
                    assert.callOrder(beforeReadSpy, utils.requireWithNoCache);
                });
        });

        it('should emit "afterFileRead" after reading each file', () => {
            const afterReadSpy = sandbox.spy().named('OnAfterFileRead');

            const emitter = new EventEmitter();
            emitter.on('afterFileRead', afterReadSpy);

            return readTests_({config: mkConfigStub(), emitter})
                .then(() => {
                    assert.calledWithExactly(afterReadSpy, '/some/path/file1.js');
                    assert.callOrder(utils.requireWithNoCache, afterReadSpy);
                });
        });
    });
});
