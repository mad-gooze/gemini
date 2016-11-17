'use strict';

const path = require('path');

const _ = require('lodash');
const Promise = require('bluebird');

const SetBuilder = require('gemini-core/lib/test-reader/set-builder');
const CoreError = require('gemini-core/lib/errors/core-error');
const validateUnknownSets = require('gemini-core/lib/utils/unknown-sets-validator');
const GeminiError = require('./errors/gemini-error');
const Suite = require('./suite');
const Events = require('./constants/events');
const testsApi = require('./tests-api');
const utils = require('./utils');

const PROJECT_TITLE = 'gemini';

const loadSuites = (sets, emitter) => {
    const rootSuite = Suite.create('');

    sets.forEachFile((path, browsers) => {
        global.gemini = testsApi(rootSuite, browsers);

        emitter.emit(Events.BEFORE_FILE_READ, path);
        utils.requireWithNoCache(path);
        emitter.emit(Events.AFTER_FILE_READ, path);

        delete global.gemini;
    });

    return rootSuite;
};

const filesExist = (configSets, optsPaths) => {
    return !_.isEmpty(configSets) || !_.isEmpty(optsPaths);
};

const getGeminiPath = (projectRoot) => path.resolve(projectRoot, PROJECT_TITLE);

module.exports = (opts, config, emitter) => {
    const filesToUse = filesExist(config.sets, opts.paths)
        ? opts.paths
        : [getGeminiPath(config.system.projectRoot)];
    const globOpts = {ignore: config.system.exclude};

    validateUnknownSets(_.keys(config.sets), opts.sets);

    return SetBuilder
        .create(config.sets, config.getBrowserIds())
        .useSets(opts.sets)
        .useFiles(filesToUse)
        .build(config.system.projectRoot, globOpts)
        .then((setCollection) => loadSuites(setCollection, emitter))
        .catch((e) => {
            if (e instanceof CoreError) {
                return Promise.reject(new GeminiError(e.message));
            }

            return Promise.reject(new Error(e.message));
        });
};
