'use strict';

const _ = require('lodash');
const SetsBuilder = require('gemini-core').SetsBuilder;
const Suite = require('./suite');
const Events = require('./constants/events');
const testsApi = require('./tests-api');
const utils = require('./utils');

const PROJECT_PATH = 'gemini';

const loadSuites = (sets, emitter) => {
    const rootSuite = Suite.create('');

    _.forEach(sets.groupByFile(), (browsers, path) => {
        global.gemini = testsApi(rootSuite, browsers);

        emitter.emit(Events.BEFORE_FILE_READ, path);
        utils.requireWithNoCache(path);
        emitter.emit(Events.AFTER_FILE_READ, path);

        delete global.gemini;
    });

    return rootSuite;
};

module.exports = (opts, config, emitter) => {
    const globOpts = {ignore: config.system.exclude};

    return SetsBuilder
        .create(config.sets, config.getBrowserIds())
        .useSets(opts.sets)
        .useFiles(opts.paths, PROJECT_PATH)
        .build(config.system.projectRoot, globOpts)
        .then((setCollection) => loadSuites(setCollection, emitter));
};
