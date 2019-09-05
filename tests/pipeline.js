// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// - global modules
const fs = require('fs');

// - our modules
const root = '../src';
const assert = require(root + '/assert.js');
const Bed = require(root + '/bed.js');
const Compiler = require(root + '/compiler.js');
const Pattern = require(root + '/pattern.js');
const Schedule = require(root + '/schedule.js');
const Shape   = require(root + '/shape.js');
const env  = require(root + '/env.js');

/**
 * Pipeline test
 *
 * @param fname the file to load
 * @param target the test target level
 */
function pipeline(fname, target){
  // load skeleton environment
  const str = fs.readFileSync(fname, 'utf-8');
  const data = JSON.parse(str);

  // load env data
  if(data.skeleton)
    env.load(data);
  else
    env.loadSkeleton(data);
  env.verbose = false;

  // get starting point
  const { node: startNode, path: startSide } = env.getStartSide();
  assert(startNode, 'No valid starting node!');

  // create shape stitches (no course connection yet)
  let shapeGroups = Shape.assemble(startNode, startSide);

  // assembly target
  if(target == 'assembly')
    return shapeGroups;

  // global layout
  let bed = null;

  // generate layout for all groups
  for(let i = 0; i < shapeGroups.length; ++i){
    const shapes = shapeGroups[i];

    // schedule shape and course traversal
    const schedule = Schedule.create(shapes);

    // create yarn path and allocate course connections
    schedule.trace();

    // apply patterning
    Pattern.transform(shapes);

    // allocate needles
    bed = Bed.allocate(schedule, 'block', bed);
  }

  // layout target
  if(target == 'layout')
    return bed;

  // generate low-level instructions
  return Compiler.generate(bed); // last full target
}

module.exports = Object.assign(pipeline, {
  assert
});
