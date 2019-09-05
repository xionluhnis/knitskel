// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// - modules
const assert = require('../assert.js');
const Compiler = require('../compiler.js');
const Bed = require('../bed.js');
const Pattern = require('../pattern.js');
const Schedule = require('../schedule.js');
const Shape   = require('../shape.js');
const sk   = require('../skeleton.js');
const env  = require('../env.js');
// - functions
const { drawDAT, saveDAT } = require('./output-dat.js');
const { drawMesh } = require('./output-mesh.js');
const drawLayout = require('./output-layout.js');
const { createSnapshot } = require('./history.js');

// - data

function updateOutput(resetOutput){
  // update list of roots
  let root = document.getElementById('output_start');
  while(root.firstChild)
    root.removeChild(root.firstChild);
  env.nodes.forEach(node => {
    if(node.category == sk.NODE_SHEET || node.category == sk.NODE_JOINT){
      ['bottom', 'top'].forEach(side => {
        if(node[side].isConnected())
          return;
        // not connected => good!
        let option = document.createElement('option');
        option.value = node.id + '/' + side;
        option.textContent = node.name + ' #' + node.id + ' / ' + side;
        root.appendChild(option);
      });
    }
    // else we can't start from it
  });
  // mask events for now
  root.onchange = () => {};
  // set active value
  let startSide = env.getStartSide();
  if(startSide)
    root.value = startSide.node.id + '/' + startSide.path;
  // update on root change
  root.onchange = () => {
    if(root.value.indexOf('/') == -1)
      return;
    let [idStr, path] = root.value.split('/');
    let nid = parseInt(idStr);
    let startNode = env.nodes.find(n => n.id == nid);
    if(startNode){
      env.setStartSide(startNode, path);
      updateOutput(resetOutput);
    }
  };

  // options
  let type = document.getElementById('output_type');
  let updateOptions = function(){
    let outputPanel = document.getElementById('output');
    outputPanel.className = type.value;
  };
  type.onchange = function(){
    updateOptions();
    let { node, path } = env.getStartSide();
    update(type.value, node, path);
  };
  updateOptions();

  // save action
  let save = document.querySelector('#output_save');
  save.onclick = function(){
    let { node, path } = env.getStartSide();
    update('save', node, path);
  };

  // if(continuous.checked || genOutput)
  let { node, path } = env.getStartSide();
  update(type.value, node, path, resetOutput);
}

function stitchSetOf(shapes){
  assert(Array.isArray(shapes), 'Invalid shape list'); 
  let stitches = new Set();
  for(let shape of shapes){
    let crs0 = shape.getCourse(0) || shape.getCourse('base');
    assert(crs0, 'No first course');
    let stitch0 = crs0.first();
    assert(stitch0, 'No first stitch');
    let queue = [ stitch0 ];
    while(queue.length){
      let s = queue.pop();
      if(!stitches.has(s)){
        stitches.add(s);
        queue.push(...s.neighbors());
      }
    }
  }
  return stitches;
}

function update(type, startNode, startSide, resetOutput){
  assert(startNode, 'No valid starting node!');
  console.log('--- Output | type=' + type + ', node=' + startNode + ', side=' + startSide);

  // only show selected output
  if(type != 'save'){
    // potentially create a snapshot
    createSnapshot('Update', 'by-action');
  }

  // create shape stitches (no course connection yet)
  let shapeGroups = Shape.assemble(startNode, startSide);
  // debug information
  if(env.verbose){
    console.log(shapeGroups);
    let numStitches = 0;
    for(let g of shapeGroups){
      let sset = stitchSetOf(g);
      numStitches += sset.size;
    }
    console.log('#stitches = ' + numStitches);
  }

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
    const optLevel = document.getElementById('opt_level').value;
    bed = Bed.allocate(schedule, optLevel, bed);
  }

  // output bed layout
  if(type == 'layout'){
    drawLayout(bed, resetOutput);
  } else if(type == 'mesh'){
    drawMesh(bed, resetOutput);
  } else {

    // compute simulation data
    bed.simulate();

    // generate low-level instructions
    let dat = Compiler.generate(bed);

    if(type == 'dat'){
      drawDAT(dat, resetOutput);
    } else if(type == 'save'){
      saveDAT(dat);
    }
  }
}


module.exports = updateOutput;
