// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// module
const assert = require('./assert.js');
const sk = require('./shapes/constants.js');
const { advancedParams, typeMap, resetUUID } = require('./shapes/node.js');

// different primitive implementations
const Sheet = require('./shapes/sheet.js');
const Joint = require('./shapes/joint.js');
const Split = require('./shapes/split.js');
const Custom = require('./shapes/custom.js');

// dynamic type change
// XXX is it needed?
function changeType(node, category){
  if(node.category == category)
    return node;
  // we must really create a new node
  if(!(category in typeMap)){
    assert.error('Type change unsupported for ' + category);
    return node;
  }
  let newNode = new typeMap[category]();
  // replace matching parameter values
  for(let propName in newNode.parameters){
    if(propName in node.parameters){
      // serialize
      let value = node.parameters[propName].toJSON();
      newNode[propName] = value;
    }
  }
  // disconnect old interfaces, saving connections
  let prevCons = []; // { src, path, node }
  for(let itf of node.getInterfaces()){
    let otherSide = itf.otherSide(node);
    if(otherSide){
      prevCons.push(Object.assign({ srcPath: itf.pathOf(node) }, otherSide)); // store copy
      itf.disconnect();
    }
  }
  // reconnect matching interfaces
  for(let itf of newNode.getInterfaces()){
    let srcPath = itf.pathOf(newNode);
    let prevCon = prevCons.find(con => con.srcPath == srcPath);
    if(prevCon){
      let prevItf = prevCon.node.getInterface(prevCon.path);
      assert(prevItf, 'Missing interface ' + prevCon.path + ' for ' + prevCon.node);
      itf.connect(prevItf);
    }
  }
  return newNode;
}


// export module
module.exports = Object.assign({
  Sheet, Joint, Split, Custom,
  resetUUID, changeType, typeMap,
  advancedParams
}, sk);
