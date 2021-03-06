'use strict';
var _ = require('lodash'),
    exec = require('child_process').execSync,
    execFile = require('child_process').execFile,
    spawn = require('child_process').spawn,
    fs = require('fs'),
    glob = require('glob'),
    gutil = require('gulp-util'),
    handlebar = require('handlebars'),
    Jasmine = require('jasmine'),
    path = require('path'),
    through = require('through2');

/*
 * Global variables
 *
 * gulpOptions: object of options passed in through Gulp
 * jasmineCSS: string path to the jasmine.css file for the specRunner.html
 * jasmineJS: array of string paths to JS needed for the specRunner.html
 * specHtml: string path to the tmp specRunner.html to be written out to
 * specRunner: string path to the specRunner JS file needed in the specRunner.html
 **/
var phantomExecutable = process.platform === 'win32' ? 'phantomjs.cmd' : 'phantomjs',
    gulpOptions = {},
    execOptions = {},
    jasmineCss, jasmineJs,
    vendorJs = [],
    specHtml = path.join(__dirname, '/lib/specRunner.html'),
    specRunner = path.join(__dirname, '/lib/specRunner.js');

function configPhantom(phantomCommand) {
  if (phantomCommand) {
    phantomExecutable = phantomCommand;
  }
}

function configJasmine(version) {
  version = version || '2.0';
  jasmineCss = path.join(__dirname, '/vendor/jasmine-' + version + '/jasmine.css');
  jasmineJs = [
    path.join(__dirname, '/vendor/jasmine-' + version + '/jasmine.js'),
    path.join(__dirname, '/vendor/jasmine-' + version + '/jasmine-html.js'),
    path.join(__dirname, '/vendor/jasmine-' + version + '/console.js'),
    path.join(__dirname, '/vendor/jasmine-' + version + '/jasmine2-junit.js'),
    path.join(__dirname, '/vendor/jasmine-' + version + '/boot.js')
  ];
}

/**
  * Removes the specRunner.html file
  **/
function cleanup(path) {
  fs.unlink(path);
}

function hasGlobalPhantom() {
  if(process.platform === 'win32') {
    try {
      exec('where phantomjs');
    } catch (e) {
      return false;
    }
  } else {
    try {
      exec('which ' + phantomExecutable);
    } catch (e) {
      return false;
    }
  }
  return true;
}

/**
 * execPhantom
 *
 * @param {string} phantom Path to phantom
 * @param {array} childArguments Array of options to pass to Phantom
 * @param {function} onComplete Callback function
 * @param {object} execOptions options to run Phantom
 */
function execPhantom(phantom, childArguments, onComplete, execOptions) {
    var phantomSpawn = spawn(phantom, childArguments, execOptions);

    phantomSpawn.stdout.on('data', (data) => {
        console.log(`${data}`);
    });

    phantomSpawn.stderr.on('data',  (data) => {
        console.log(`${data}`);
    });

    phantomSpawn.on('close', function(error, stdout, stderr) {
      var success = null;

      if(error !== 0) {
        console.log('Error:');
        console.log(error);
        // success = new gutil.PluginError('gulp-jasmine-phantomjs', error.code + ': Tests contained failures. Check logs for details.');
      }

      if (stderr) {
        gutil.log('gulp-jasmine-phantom: Failed to open test runner ' + gutil.colors.blue(childArguments[1]));
        gutil.log(gutil.colors.red('error: '), stderr);
        console.log('error: ', stderr);
        success = new gutil.PluginError('gulp-jasmine-phantomjs', 'Failed to open test runner ' + gutil.colors.blue(childArguments[1]));
      }

      if(gulpOptions.specHtml === undefined && (gulpOptions.keepRunner === undefined || gulpOptions.keepRunner === false)) {
        cleanup(childArguments[1]);
      }

      onComplete(success);
    });
}

/**
  * Executes Phantom with the specified arguments
  *
  * childArguments: Array of options to pass Phantom
  * [jasmine-runner.js, specRunner.html]
  **/
function runPhantom(childArguments, onComplete, execOptions) {
  if(hasGlobalPhantom()) {
    execPhantom(phantomExecutable, childArguments, onComplete, execOptions);
  } else {
    gutil.log(gutil.colors.yellow('gulp-jasmine-phantom: Global Phantom undefined, trying to execute from node_modules/phantomjs'));
    execPhantom(process.cwd() + '/node_modules/.bin/' + phantomExecutable, childArguments, onComplete, execOptions);
  }
}

/*
 * Reads in the handlebar template and creates a data HTML object in memory to create
 *
 * options: list of options that can be passed to the function
 *  files: paths to files being tested
 *  onComplete: callback to call when everything is done
 **/
function compileRunner(options, execOptions, phantomArguments) {
  var filePaths = options.files || [],
      onComplete = options.onComplete || {},
      vendorFiles = {};

  phantomArguments = phantomArguments || [];
  fs.readFile(path.join(__dirname, '/lib/specRunner.handlebars'), 'utf8', function(error, data) {
    if (error) {
      throw error;
    }

    var vendorScripts = gulpOptions.vendor;

    if (vendorScripts) {
      if (typeof vendorScripts === 'string') {
        vendorScripts = [vendorScripts];
      }

      vendorScripts.forEach(function(fileGlob) {
        if (fileGlob.match(/^http/)) {
          vendorJs.push(fileGlob);
        }
        else {
          glob.sync(fileGlob, {nosort: true}).forEach(function(newFile) {
            vendorJs.push(path.join(process.cwd(), newFile));
          });
        }
      });

    }

    vendorJs.forEach(function(js) {
      vendorFiles[js] = true;
    });

    //Get unique vendor files, because of brace-expanded patterns can result in the same file showing up multiple times
    vendorJs = Object.keys(vendorFiles);

    // Create the compile version of the specRunner from Handlebars
    var reportPath = typeof(gulpOptions.reportPath) === 'string' ? gulpOptions.reportPath : 'TestResults';

    var specData = handlebar.compile(data),
        specCompiled = specData({
          files: filePaths,
          jasmineCss: jasmineCss,
          jasmineJs: jasmineJs,
          vendorJs: vendorJs,
          specRunner: specRunner,
          JUnitreportPath: reportPath
        });

    if(gulpOptions.keepRunner !== undefined && typeof gulpOptions.keepRunner === 'string') {
      specHtml = path.join(path.resolve(gulpOptions.keepRunner), '/specRunner.html');
    }

    fs.writeFile(specHtml, specCompiled , function(error) {
      if (error) {
        throw error;
      }

      if(gulpOptions.integration) {
        var childArgs = phantomArguments.concat([
          path.join(__dirname, '/lib/jasmine-runner.js'),
          specHtml,
          JSON.stringify(gulpOptions)
        ]);
        runPhantom(childArgs, onComplete, execOptions);
      } else {
        onComplete(null);
      }
    });
  });
}

module.exports = function (options, execOptions, phantomArguments) {
  var filePaths = [];

  gulpOptions = options || {};
  execOptions = execOptions || {};
  phantomArguments = phantomArguments || [];
  configJasmine(gulpOptions.jasmineVersion);
  configPhantom(execOptions.phantomCommand);

  if(!!gulpOptions.integration) {
    return through.obj(
      function (file, encoding, callback) {
        if (file.isNull()) {
          callback(null, file);
          return;
        }
        if (file.isStream()) {
          callback(new gutil.PluginError('gulp-jasmine-phantom', 'Streaming not supported'));
          return;
        }
        filePaths.push(file.path);
        callback(null, file);
      }, function (callback) {
        gutil.log('Running Jasmine with PhantomJS');
        try {
          if(gulpOptions.specHtml) {
            runPhantom(
              phantomArguments.concat([
                path.join(__dirname, '/lib/jasmine-runner.js'),
                path.resolve(gulpOptions.specHtml),
                JSON.stringify(gulpOptions)
              ]), function(success) {
              callback(success);
            }, execOptions);
          } else {
            compileRunner({
              files: filePaths,
              onComplete: function(success) {
                callback(success);
              }
          }, execOptions, phantomArguments);
          }
        } catch(error) {
          callback(new gutil.PluginError('gulp-jasmine-phantom', error));
        }
      }
    );
  }

  return through.obj(
    function(file, encoding, callback) {
      if (file.isNull()) {
        callback(null, file);
        return;
      }

      if (file.isStream()) {
        callback(new gutil.PluginError('gulp-jasmine-phantom', 'Streaming not supported'));
        return;
      }

      /**
      * Get the cache object of the specs.js file,
      * get its children and delete the childrens cache
      */
      var modId = require.resolve(path.resolve(file.path));
      var files = require.cache[modId];
      if (typeof files !== 'undefined') {
        for (var i in files.children) {
          delete require.cache[files.children[i].id];
        }
      }
      delete require.cache[modId];

      filePaths.push(path.relative(process.cwd(), file.path));
      callback(null, file);
    },
    function(callback) {
      gutil.log('Running Jasmine in Node');
      try {
        var jasmine = new Jasmine(),
            terminalReporter = require('./lib/terminal-reporter.js').TerminalReporter;

        jasmine.addReporter(new terminalReporter(_.defaults(gulpOptions, {showColors: true})));

        jasmine.loadConfig({
          random: _.get(gulpOptions, 'random', false),
          spec_files: filePaths
        });

        if (_.has(gulpOptions, 'seed')) {
          jasmine.seed(gulpOptions.seed);
        }

        jasmine.onComplete(function(passed) {
          callback(null);
        });

        jasmine.execute();

      } catch(error) {
        callback(new gutil.PluginError('gulp-jasmine-phantom', error));
      }

    }
  );
};
