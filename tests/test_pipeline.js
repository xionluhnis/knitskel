// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// - modules
const fs = require('fs');
const path = require('path');
const pipeline = require('./pipeline.js');
const assert = pipeline.assert;

// - constants
const basedir = path.dirname(process.argv[1]);
const target = process.argv[2] || 'layout';
const files = Array.from(process.argv).slice(3) || [];

// quiet
process.stdout.write('----------------\nTesting: \x1b[34m' + target + '\x1b[0m\n----------------\n');
console.log = function(){};
process.exitCode = 0; // default

/**
 * Test pipeline by running it on a skeleton and checking assertions or errors
 *
 * @param fname the skeleton file name
 */
function test(fname){
  if(!fname.endsWith('.skel'))
    return;
  // clear errors
  assert.clearAll();

  // run pipeline
  process.stdout.write(path.basename(fname) + ' : ');
  let errors = [];
  try {
    pipeline(fname, target);
  } catch(err){
    process.exitCode = 2;
    errors = [{ args: [err], caught: true }];
  }
  errors.push(...assert.errorList());

  if(errors.length){
    process.exitCode = Math.max(process.exitCode, 1);
    process.stdout.write('\x1b[31mfailed\x1b[0m... \x1b[31m' + errors.length + ' errors\x1b[0m\n');
    // console.log('- failed ...', errors.length, 'errors');
    for(let err of errors){
      process.stdout.write('- \x1b[31m' + (err.caught ? 'Caught: ' : '') + err.args.join(' ') + '\x1b[0m\n');
    }
  } else {
    process.stdout.write('\x1b[32mpassed\x1b[0m\n');
  }
}

// get over list of skeletons
if(files.length){
  for(let fname of files)
    test(fname);
} else {
  fs.readdir(basedir + '/skeletons', function(err, items){
    for(let skel of items){
      test(basedir + '/skeletons/' + skel);
    }
  });
}
