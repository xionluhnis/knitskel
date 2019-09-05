// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');
const { inferSize } = require('../infer.js');
const Parameter = require('../param.js');
const { NUMBER, STRING, PATTERN } = Parameter;
const sk = require('./constants.js');

let __nodeID = -1; // start at -1 for Node.defaults to be special

// ############################################################################
// ##### Parameter Creation ###################################################
// ############################################################################

function LinkParam(NodeType, name){
  Object.defineProperty(NodeType.prototype, name, {
    get: function(){
      return this.parameters[name].eval();
    },
    set: function(newValue){
      this.parameters[name].update(newValue);
    },
    enumerable: true
  });
}
function AddParam(NodeType, type, name, value, constraints) {
  let descriptors; 
  if(NodeType.prototype.descriptors)
    descriptors = NodeType.prototype.descriptors;
  else
    descriptors = NodeType.prototype.descriptors = [];
  descriptors.push({ name, type, value, constraints });
  LinkParam(NodeType, name);
}
function InheritParams(NodeType, ParentNodeType){
  for(let { name } of ParentNodeType.prototype.descriptors)
    LinkParam(NodeType, name);
}
function CreateParams(NodeType, node, values){
  if(!values)
    values = {};
  let descriptors = NodeType.prototype.descriptors || [];
  if(!node.parameters)
    node.parameters = {};
  let parameters = node.parameters;
  for(let desc of descriptors){
    let value = desc.value;
    if(desc.name in values){
      let val = values[desc.name];
      if(val !== undefined)
        value = val;
    }
    let param = parameters[desc.name] = new Parameter(node, desc.name, desc.type, value);
    if(desc.constraints)
      Object.assign(param.constraints, desc.constraints);
  }
}

// ############################################################################
// ##### Base Node ############################################################
// ############################################################################

/**
 * Generic node parameter settings
 *
 * @param name the node name
 * @param category the node category
 */
function Node(name, category){
  CreateParams(Node, this, {
    id: __nodeID++, name, category
  });
}
// identifiers
AddParam(Node, NUMBER,  'id');
AddParam(Node, STRING,  'name', 'node');
AddParam(Node, STRING,  'category', 'node');
// patterning
AddParam(Node, PATTERN, 'pattern',  '');
AddParam(Node, STRING,  'numbering', sk.PATTERN_AUTO,
  { within: [ sk.PATTERN_AUTO, sk.PATTERN_UPWARD, sk.PATTERN_DOWNWARD ] });
// bed layout
AddParam(Node, STRING,  'gauge', sk.FULL_GAUGE,
  { within: [ sk.FULL_GAUGE, sk.HALF_GAUGE ] });
AddParam(Node, STRING,  'increase', sk.INCREASE_AUTO,
  { within: [ sk.INCREASE_AUTO, sk.INCREASE_SPLIT, sk.INCREASE_KICKBACK ] });
AddParam(Node, NUMBER,  'expansion', 0, { min: 0, integer: true });    // jump economizer to use for expandability
AddParam(Node, STRING, 'casting', sk.CASTING_AUTO,
  { within: [sk.CASTING_AUTO, sk.CASTING_SAFE, sk.CASTING_UNSAFE] });
// annotate expert parameters
Node.advancedParams = [
  'numbering', 'increase', 'expansion', 'casting'
];
// manual fixes
// AddBoolean(Node, 'flip', null);

// ############################################################################
// ##### Interface ############################################################
// ############################################################################

/**
 * Interface function / class
 */
function Interface(node1, path1, node2, path2, state){
  Node.call(this, 'itf', sk.NODE_INTERFACE);
  // graph properties
  this.sides    = [null, null];
  // the first side should always exist
  // except when deserializing
  // assert(node1 && path1, 'Invalid interface with null first side');
  if(node1 && path1){
    this.sides[0] = {
      node: node1, path: path1
    };
  }
  // the second side may be empty
  if(node2 && path2){
    // assert(getInterface(node2, path2), 'Invalid path ' + path2 + ' for node ' + node2);
    this.sides[1] = {
      node: node2, path: path2
    };
  } else if(node2 && !path2 && state)
    state = node2; // using three arguments (node1, path1, state) instead of 5

  // interface properties
  this.rotation = 0;
  this.state    = state || sk.OPEN;

  // interface properties
  CreateParams(Interface, this);
}
InheritParams(Interface, Node);
AddParam(Interface, STRING, 'caston',  sk.CASTON_AUTO,
  { within: [ sk.CASTON_AUTO, sk.CASTON_INTERLOCK, sk.CASTON_KICKBACK, sk.CASTON_TUCK, sk.CASTON_PRECAST, sk.CASTON_NONE ] });
AddParam(Interface, STRING, 'castoff', sk.CASTOFF_AUTO,
  { within: [ sk.CASTOFF_AUTO, sk.CASTOFF_DIRECT, sk.CASTOFF_REVERSE, sk.CASTOFF_PICKUP, sk.CASTOFF_NONE ] });

// interface methods
Interface.prototype.isConnected = function(){
  return this.sides[0] && this.sides[1];
};
Interface.prototype.connectTo = function(other){
  // we do not disconnect
  if(this.isConnected())
    return false; // cannot connect
  if(other.isConnected())
    return false; // cannot connect
  assert(!this.sides[1] && !other.sides[1], 'Invalid interface connections');
  // replace both sides with a single common interface
  let thisSide = this.sides[0];
  let otherSide = other.sides[0];
  // do not allow the same source
  let thisParent = thisSide.node.parent ? thisSide.node.parent : thisSide.node;
  let otherParent = otherSide.node.parent ? otherSide.node.parent : otherSide.node;
  if(thisParent.id == otherParent.id)
    return false;

  // we are ok to go!
  let inter = new Interface(thisSide.node, thisSide.path, otherSide.node, otherSide.path, sk.CONNECTED);
  let res = true;
  res &= setInterface(thisSide.node, thisSide.path, inter);
  res &= setInterface(otherSide.node, otherSide.path, inter);
  if(!res)
    console.error('connectTo failed');
  return res; // note: if false, we may have corrupted the data structure
};
Interface.prototype.thisSide = function(node){
  // matching node - node
  //       or node - node.parent (anchor)
  //       or node.parent - node (anchor)
  if(this.sides[0].node.id == node.id
  || this.sides[0].node.parent && this.sides[0].node.parent.id == node.id
  || node.parent && this.sides[0].node.id == node.parent.id)
    return this.sides[0];
  else
    return this.sides[1];
};
Interface.prototype.otherSide = function(node){
  // matching node - node
  //       or node - node.parent (anchor)
  //       or node.parent - node (anchor)
  if( this.sides[0].node.id == node.id // node match
  || (this.sides[0].node.parent && this.sides[0].node.parent.id == node.id) // node match anchor parent
  || (node.parent && this.sides[0].node.id == node.parent.id)) // anchor parent match node
  {
    return this.sides[1];
  } else {
    return this.sides[0];
  }
};
Interface.prototype.disconnect = function(){
  if(!this.isConnected())
    return false; // nothing to disconnect
  let ok = true;
  this.sides.forEach(side => {
    let inter = new Interface(side.node, side.path, sk.CLOSED); // leave closed by default
    ok &= setInterface(side.node, side.path, inter);
  });
  if(!ok)
    console.error('disconnect failed');
  return ok;
};
Interface.prototype.pathOf = function(node){
  if(!node)
    return null;
  if(this.sides[0].node.id == node.id)
    return this.sides[0].path;
  if(this.sides[1] && this.sides[1].node.id == node.id)
    return this.sides[1].path;
  return null;
};
Interface.prototype.toString = function(){
  return 'Interface(id=' + this.id + ', state=' + this.state + ')';
};
Interface.prototype.toJSON = function(){
  return Object.assign(Node.toJSON(this), {
    sides: this.sides.map(s => {
      return s ? { node: s.node.id, path: s.path } : null;
    }),
    rotation: this.rotation, state: this.state
  });
};
Interface.prototype.loadJSON = function(data){
  Node.loadJSON(this, data);
  // load data
  if('state' in data)
    this.state = data.state;
  if('rotation' in data)
    this.rotation = data.rotation;
  // load sides
  if('sides' in data){
    assert(Array.isArray(data.sides), 'Sides must be an array');
    assert(data.sides.length <= 2, 'There can be at most 2 sides');
    assert(data.sides[0], 'First side must exist');
    for(let i = 0; i < 2; ++i){
      if(data.sides[i]){
        assert(typeof data.sides[i].node == 'number', 'Node must be an integer');
        assert(typeof data.sides[i].path == 'string', 'Path must be a string');
        this.sides[i] = {
          node: data.sides[i].node,
          path: data.sides[i].path
        };
      } else
        this.sides[i] = data.sides[i];
    }
  }
};
Interface.prototype.getInterfaces = function(){
  return [];
};
Interface.prototype.remapNodes = function(map){
  this.sides.forEach( side => {
    if(side)
      side.node = map(side.node);
  });
};
Interface.prototype.getSize = function(){
  return inferSize(this.sides[0].node, this.sides[0].path);
};

/**
 * Get a node interface from the node and the hook name
 *
 * @param node node element
 * @param path property chain to access the interface
 * @return the interface if it exists
 */
function getInterface(node, path){
  if(!node || !path)
    return null;
  let tokens = path.split('/');
  let inter = node;
  for(let i = 0; i < tokens.length && inter; ++i){
    let name = tokens[i];
    if(Array.isArray(inter))
      inter = inter[parseInt(name)];
    else if(name in inter)
      inter = inter[name];
    else
      return null;
  }
  return inter;
}

/**
 * Replace a node interface
 *
 * @param node
 * @param path property chain to the interface
 * @param inter new interface
 * @param create whether to create (default is replace)
 * @return whether it worked
 */
function setInterface(node, path, inter, create){
  assert(node && path, 'Invalid node or interface path');
  assert(inter, 'Should not delete interfaces');
  let tokens = path.split('/');
  // go through path
  let base = node;
  for(let i = 0; i < tokens.length - 1; ++i){
    let name = tokens[i];
    if(Array.isArray(base))
      base = base[parseInt(name)];
    else if(name in base)
      base = base[name];
    else
      return false;
  }
  // replace at the last stage
  let last = tokens[tokens.length-1];
  if(Array.isArray(base))
    base[parseInt(last)] = inter;
  else if(create || last in base)
    base[last] = inter;
  else
    return false;
  return true;
}

// store as static properties
Node.Interface = Interface;
Node.getInterface = getInterface;
Node.setInterface = setInterface;

// 
// ############################################################################
// ##### Factory Methods ######################################################
// ############################################################################

// default node with its properties for serialization
Node.defaults = new Node();
Node.toJSON = function(node){
  // base properties (only if different from default)
  let json = {};
  for(let name in node.parameters){
    let prop = node.parameters[name];
    if(name in Node.defaults.parameters && Node.defaults[name] == prop.value)
      continue; // skip default node values
    json[name] = prop.toJSON(); // serialize parameter
  }
  return json;
};
Node.loadJSON = function(node, data){
  // base properties
  // /!\ except the id, which must stay unique and thus is only used for mapping
  // but not as an actual serialized value that should be restored
  for(let name in node.parameters){
    if(name in data && name != 'id')
      node[name] = data[name];
  }
};

Node.resetUUID = function() {
  __nodeID = 0;
};

const typeInfo = {};
Node.typeMap = { [sk.INTERFACE]: Interface };

Node.init = function(self, name, type){
  Node.call(self, name, type);
  // graph properties
  if('interfaces' in typeInfo[type]){
    let itfNames = typeInfo[type].interfaces;
    assert(Array.isArray(itfNames), 'Interfaces must be a list of strings');
    for(let itfName of itfNames){
      let itf = new Interface(self, itfName);
      // self[itfName] = new Interface(this, itfName);
      setInterface(self, itfName, itf, true); // create initially
    }
  }
  // node properties
  CreateParams(Node.typeMap[type], self);
};

// @see https://stackoverflow.com/questions/5999998/how-can-i-check-if-a-javascript-variable-is-function-type
function isFunction(functionToCheck) {
   return functionToCheck && {}.toString.call(functionToCheck) === '[object Function]';
}

function hasMethod(fun, name){
  assert(fun, 'Invalid class argument');
  const implFun = fun.prototype[name];
  return implFun && isFunction(implFun);
}

function mustImplement(fun, name){
  assert(hasMethod(fun, name),
    'Missing implementation of ::' + name + '()');
}

Node.register = function(type, fun, config){
  assert(!(type in typeInfo), 'Overwriting registration for', type);
  Node.typeMap[type] = fun;
  typeInfo[type] = config;

  // inherit parameters
  if('inherits' in config){
    if(config.inherits == 'default')
      config.inherits = Node;
    InheritParams(fun, config.inherits);
  }

  if('interfaces' in config){
    if(config.interfaces == 'default')
      config.interfaces = ['bottom', 'top'];
    assert(Array.isArray(config.interfaces), 'Interfaces must be an array');
  }

  // register parameters
  for(let name in config.params){
    let [paramType, ...args] = config.params[name];
    AddParam(fun, paramType, name, ...args);
  }

  // toString
  const funName = type.charAt(0).toUpperCase() + type.substring(1);
  if('toString' in config){
    if(isFunction(config.toString))
      fun.prototype.toString = config.toString;
    else {
      assert(Array.isArray(config.toString), 'Invalid toString configuration');
      fun.prototype.toString = function(){
        return funName + '(' + config.toString.map(name => name + '=' + this[name]).join(', ') + ')';
      };
    }
  } else if(!fun.prototype.toString) {
    fun.prototype.toString = function(){
      return funName;
    };
  }

  // interfaces methods
  // - getInterfacePaths()
  if('interfaces' in config){
    const interfaces = config.interfaces;
    assert(Array.isArray(interfaces), 'Interfaces must be a list of strings for automatic implementation');
    fun.prototype.getInterfacePaths = function(){
      return interfaces.slice();
    };
  } else {
    mustImplement(fun, 'getInterfacePaths');
  }
  // - getInterface(path)
  if(!hasMethod(fun, 'getInterface')){
    fun.prototype.getInterface = function(path){
      return getInterface(this, path);
    };
  }
  // - getInterfaces()
  if(!hasMethod(fun, 'getInterfaces')){
    fun.prototype.getInterfaces = function(){
      return this.getInterfacePaths().map(name => getInterface(this, name));
    };
  }
  // - remapNodes(map)
  if(!hasMethod(fun, 'remapNodes')){
    fun.prototype.remapNodes = function(map){
      for(let path of this.getInterfacePaths()){
        let curItf = getInterface(this, path);
        let newItf = map(curItf);
        setInterface(this, path, newItf);
      }
    };
  }
  mustImplement(fun, 'getInterface');
  mustImplement(fun, 'getInterfaces');
  mustImplement(fun, 'remapNodes');

  // JSON methods
  // - toJSON
  if(!hasMethod(fun, 'toJSON')){
    fun.prototype.toJSON = function(){
      let json = Node.toJSON(this);
      // additionally add interface information
      for(let itf of this.getInterfaces()){
        let side = itf.thisSide(this);
        assert(side && side.path, 'Invalid interface side');
        json[side.path] = itf.id; // serialized interface link
      }
      return json;
    };
  }
  // - loadJSON(data)
  if(!hasMethod(fun, 'loadJSON')){
    fun.prototype.loadJSON = function(data){
      Node.loadJSON(this, data);
      // load interfaces
      for(let path of this.getInterfacePaths()){
        if(path in data){
          if(data[path] === undefined)
            continue; // skip undefined interfaces
          this[path] = data[path];
          assert(typeof data[path] == 'number', 'JSON interfaces must be numbers');
        }
      }
    };
  }
  // done registering
};

module.exports = Node;
