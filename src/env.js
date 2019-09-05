// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// import
const assert = require('./assert.js');
const sk = require('./skeleton.js');
const Parameter = require('./param.js');

// private stores
const panelEvents = {};
const panelStates = {};
const startSide = {};
const staticResources = require('./assets/images.js');
const userResources = {};

function defaultGlobal(){
  return {
    // global patterns
    beforePattern: '',
    afterPattern:  '',
    // type of increases
    increase: sk.INCREASE_KICKBACK,
    // type of cast on/off
    castOnType: sk.CASTON_INTERLOCK,
    castOffType: sk.CASTOFF_PICKUP,
    // dat parameters
    wasteFabric: false,
    needlePos: -10,
    useDSCS: false
  };
}

// export
const env = module.exports = {
  // containers
  nodes: [ new sk.Sheet('sheet') ],
  hints: [],
  // panel
  registerPanel: function(name, toggleFunc){
    assert(!(name in panelEvents), 'Double registration of a panel');
    panelEvents[name] = toggleFunc;
    panelStates[name] = false;
  },
  openPanel: function(name) {
    assert(name in panelEvents, 'Invalid panel');
    (panelEvents[name] || function(){})(true);
    panelStates[name] = true;
  },
  closePanel: function(name) {
    assert(name in panelEvents, 'Invalid panel');
    (panelEvents[name] || function(){})(false);
    panelStates[name] = false;
  },
  togglePanel: function(name) {
    assert(name in panelEvents, 'Invalid panel');
    (panelEvents[name] || function(){})();
    panelStates[name] = !panelStates[name];
  },
  isPanelOpen: function(name) {
    return panelStates[name];
  },
  // global variables
  global: defaultGlobal(),
  // parameters
  verbose: false,
  keepDuplicates: false,

  // check if node is still valid
  isNodeValid: function(nid){
    return env.nodes.find(n => n.id == nid);
  },

  // removing nodes
  removeNode: function(node){
    env.nodes = env.nodes.filter(n => {
      if(n.parent)
        return n.parent.id != node.id;
      return n.id != node.id;
    });
    // unset startSide if it is from that node
    if(startSide && startSide.node == node){
      startSide.node = null;
      startSide.path = null;
    }
  },

  // start interface
  checkStartInterface: function(){
    if(startSide.node){
      // is it still in the list of nodes?
      if(!env.nodes.includes(startSide.node))
        startSide.node = null;
      // is it still a valid interface?
      else {
        let itf = startSide.node.getInterface(startSide.path);
        if(!itf || itf.isConnected())
          startSide.node = null;
      }
    }
  },
  getStartInterface: function(){
    env.checkStartInterface();
    if(startSide.node)
      return startSide.node.getInterface(startSide.path);
    else {
      return env.getInterfaces().find(itf => !itf.isConnected());
    }
  },
  getStartSide: function(){
    env.checkStartInterface();
    if(startSide.node)
      return Object.assign({}, startSide);
    else{
      let itf = env.getStartInterface();
      if(itf)
        return Object.assign({}, itf.sides[0]);
      else
        return null;
    }
  },
  setStartInterface: function(itf){
    assert(!itf.isConnected(), 'Cannot use connected interface as start');
    assert(env.nodes.includes(itf.sides[0].node), 'Starting from interface to unknown node');
    Object.assign(startSide, itf.sides[0]);
  },
  setStartSide: function(node, path){
    if(!path && node.path && node.node){
      path = node.path;
      node = node.node;
    }
    startSide.node = node;
    startSide.path = path;
  },

  // serialization methods
  getInterfaces: function(){
    let itfs = [];
    let itfMap = {};
    for(let n of env.nodes){
      for(let itf of n.getInterfaces()){
        if(itf.id in itfMap)
          continue;
        else {
          itfMap[itf.id] = itf;
          assert(typeof itf != 'number', 'Dangling numeric interface');
          itfs.push(itf);
        }
      }
    }
    return itfs;
  },

  resetGlobal: function(){
    env.global = defaultGlobal();
  },

  // resources
  setResource: function(name, data){
    assert(typeof name == 'string' && typeof data == 'string',
      'Only support string resources');
    userResources[name] = data;
  },
  getResource: function(name){
    return userResources[name] || staticResources[name];
  },
  getResourceKeys: function(){
    return [...new Set([...Object.keys(userResources), ...Object.keys(staticResources)])];
  },

  // serialization
  serializeSkeleton: function (minimal){
    let start = env.getStartInterface();
    // list of nodes and interfaces
    let itfs = env.getInterfaces();
    let nodes = env.nodes.concat(itfs);
    // list of user parameters
    let params = Parameter.getUserParameters().filter(p => !minimal || p.references.size).map(p => {
      return { name: p.name, category: 'parameter', value: p.value };
    });
    if(env.verbose)
      console.log('Saving ' + nodes.length + ' nodes (' + env.nodes.length + 'n/' + itfs.length + 'i) and ' + params.length + ' user parameters');
    let jsonList = nodes.map(n => {
      let json = n.toJSON();
      if(start == n){
        json.start = true;
      }
      return json;
    });
    return jsonList.concat(params);
  },
  serialize: function(){
    return {
      skeleton: env.serializeSkeleton(),
      global: Object.assign({}, env.global),
      resources: Object.assign({}, userResources), // excludes staticResources
      ui: {
        verbose: env.verbose,
        keepDuplicates: env.keepDuplicates
      }
    };
  },
  loadSkeleton: function(data){
    // reset ids
    sk.resetUUID();
    Parameter.clearUserParameters();
    let oldNodes = {};
    let oldItfs  = {};
    env.nodes.splice(0, env.nodes.length);

    // starting interface
    let startItf = null;

    // re-create all nodes
    console.log('Recreating ' + data.length + ' nodes');
    for(let n of data){
      if(n.category == 'parameter'){
        // create parameter
        let param = Parameter.getUserParameter(n.name, true);
        param.update(n.value);
        continue;
      }
      assert(n.category in sk.typeMap, 'Invalid node category: ' + n.category);
      let node = new sk.typeMap[n.category]();
      if(!node){
        console.log('Unsupported node: ' + JSON.stringify(n));
        continue;
      }

      // store node
      if(node.category != sk.NODE_INTERFACE){
        env.nodes.push(node);
        oldNodes[n.id] = node;
      } else {
        oldItfs[n.id] = node;
        // check for start
        if(n.start)
          startItf = node;
      }

      // load JSON data into the node
      node.loadJSON(n);
    }

    // map identifiers to actual nodes
    for(let oldID in oldNodes){
      let node = oldNodes[oldID];
      console.log('Linking of node ' + node);
      node.remapNodes(nodeID => {
        assert(nodeID in oldItfs, 'Missing node ' + nodeID + ' when remapping in ' + node);
        return oldItfs[nodeID];
      });
    }
    for(let oldID in oldItfs){
      let node = oldItfs[oldID];
      console.log('Linking of itf ' + node);
      node.remapNodes(nodeID => {
        assert(nodeID in oldNodes, 'Missing node ' + nodeID + ' when remapping in ' + node);
        return oldNodes[nodeID];
      });
    }

    // check interfaces
    env.getInterfaces();

    // set new start interface
    if(startItf){
      env.setStartInterface(startItf);
    }
  },
  load: function(envData){
    // load skeleton
    assert('skeleton' in envData, 'Invalid environment data');
    env.loadSkeleton(envData.skeleton);

    // load global pattern
    if('global' in envData)
      Object.assign(env.global, envData.global);

    // load resources
    if('resources' in envData)
      Object.assign(userResources, envData.resources);

    // load ui information
    for(let key in envData.ui){
      env[key] = envData.ui[key];
    }
  }
};
