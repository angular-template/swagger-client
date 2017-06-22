'use strict';

const process = require('process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const needle = require('needle')
const _ = require('lodash');

const swagenCore = require('swagen-core');
const cli = swagenCore.cli;

const helpCommand = require('../help');

const currentDir = process.cwd();

const configScriptFileName = 'swagen.config.js';
const configJsonFileName = 'swagen.config.json';

function getConfig() {
    let configScript = path.resolve(currentDir, configScriptFileName);
    if (fs.existsSync(configScript)) {
        return require(configScript);
    }

    let configJson = path.resolve(currentDir, configJsonFileName);
    if (fs.existsSync(configJson)) {
        return require(configJson);
    }

    let errorMessage = [
        `Specify a ${configScriptFileName} or ${configJsonFileName} file to configure the swagen tool.`,
        ``,
        `To create a configuration file in the current directory, use the following command:`,
        ``,
        `    swagen init`,
        ``,
        `This will ask you a series of questions and generate a configuration file based on your answers.`
    ].join(os.EOL);
    throw errorMessage;
}

/**
 * Ensure that the profile structure is valid.
 */
function verifyProfile(profile) {
    if (!profile.file && !profile.url) {
        throw new Error(`[${profileKey}] Must specify a file or url in the configuration.`);
    }
    if (!profile.output) {
        throw new Error(`[${profileKey}] Must specify an output file path in the configuration.`);
    }
    if (!profile.generator) {
        throw new Error(`[${profileKey}] Must specify a generator in the configuration.`);
    }
    if (profile.generator.toLowerCase() === 'core') {
        throw new Error(`[${profileKey}] Invalid generator ${profile.generator}. This name is reserved.`);
    }
    if (profile.generator.match(/^[\w\-]+-language$/i)) {
        throw new Error(`[${profileKey}] Invalid generator ${profile.generator}. The -language suffix is reserved for language helper packages.`);
    }
    if (!profile.debug) {
        profile.debug = {};
    }
    if (!profile.transforms) {
        profile.transforms = {};
    }
    if (!profile.options) {
        profile.options = {};
    }
}

/**
 * Reads the swagger json from a file specified in the profile.
 * @param {Profile} profile - The profile being handled.
 * @param {String} profileKey - The name of the profile.
 */
function handleFileSwagger(profile, profileKey) {
    let inputFilePath = path.resolve(currentDir, profile.file);
    cli.info(`[${profileKey}] Input swagger file : ${inputFilePath}`);
    fs.readFile(inputFilePath, 'utf8', function(error, swagger) {
        if (error) {
            cli.error(`Cannot read swagger file '${profile.file}'.`);
            cli.error(error);
        } else {
            handleSwagger(swagger, profile, profileKey);
        }
    });
}

/**
 * Reads the swagger json from a URL specified in the profile.
 * @param {Profile} profile - The profile being handled.
 * @param {String} profileKey - The name of the profile.
 */
function handleUrlSwagger(profile, profileKey) {
    cli.info(`[${profileKey}] Input swagger URL : ${profile.url}`);
    needle.get(profile.url, function(err, resp, body) {
        if (err) {
            cli.error(`Cannot read swagger URL '${profile.url}'.`);
            cli.error(err);
        } else {
            handleSwagger(body, profile, profileKey);
        }
    });
}

/**
 * Iterates through each profile in the config and handles the swagger.
 */
function processInputs(config) {
    for (let profileKey in config) {
        let profile = config[profileKey];
        if (profile.skip) {
            continue;
        }

        verifyProfile(profile);

        if (profile.file) {
            handleFileSwagger(profile, profileKey);
        } else {
            handleUrlSwagger(profile, profileKey);
        }
    }
}

function handleSwagger(swagger, profile, profileKey) {
    // swagger should be an object. If it is a string, parse it.
    if (typeof swagger === 'string') {
        try {
            swagger = JSON.parse(swagger);
        } catch (e) {
            cli.error(`Invalid swagger source for profile '${profileKey}'.`);
            if (e instanceof SyntaxError) {
                if (!!e.lineNumber) {
                    cli.error(`At line number ${e.lineNumber}.`);
                }
                if (!!e.message) {
                    cli.error(e.message);
                }
            }
            return;
        }
    }

    let parser = new swagenCore.Parser(swagger);
    let definition = parser.parse();
    if (profile.debug.definition) {
        let definitionJson = JSON.stringify(definition, null, 4);
        fs.writeFileSync(path.resolve(currentDir, profile.debug.definition), definitionJson, 'utf8');
        cli.debug(`[${profileKey}] Definition file written to '${profile.debug.definition}'.`);
    }

    let generatorPkg;
    if (_.startsWith(profile.generator, '.')) {
        generatorPkg = require(path.resolve(currentDir, profile.generator));
    } else {
        generatorPkg = require(`swagen-${profile.generator}`);
    }
    if (typeof generatorPkg.validateProfile === 'function') {
        generatorPkg.validateProfile(profile);
    }
    let output = generatorPkg.generate(definition, profile);

    let outputFilePath = path.resolve(currentDir, profile.output);
    fs.writeFileSync(path.resolve(currentDir, outputFilePath), output, 'utf8');
    cli.info(`[${profileKey}] Code generated at '${outputFilePath}'.`);
}

module.exports = function(args) {
    try {
        let config = getConfig();
        processInputs(config);
    } catch (ex) {
        if (typeof ex === 'string') {
            cli.error(ex);
            helpCommand();
        } else {
            console.log(ex);
        }
    }
};