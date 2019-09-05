// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const selectNode = require('./params.js');
const updateOutput = require('./output.js');
const fi   = require('./filters.js');
const sg   = require('./graph.js');
const Parameter = require('../param.js');
const Pattern = require('../pattern.js');
const sk   = require('../skeleton.js');
const env  = require('../env.js');

// state
let selectedSide = null;
let selectedInterface = null;
let catInit = false;
let interfaces = [];
let nodeMap = {};

function renderSkeleton(updateGraph, resetOutput){
  let skel = document.querySelector('#skeleton');
  let self = module.exports.renderSkeleton; // strong self-reference
  
  // interface selection feedback
  if(selectedInterface){
    skel.classList.add('inter');
  } else {
    skel.classList.remove('inter');
  }

  // initialize categories
  initCategories();
  
  // clear
  while(skel.firstChild)
    skel.removeChild(skel.firstChild);
  
  // data
  let domParent = {};

  let newSpan = function(className, text, onclick){
    let span = document.createElement('span');
    if(Array.isArray(className))
      className.forEach(name => { span.classList.add(name); });
    else
      span.classList.add(className);
    span.textContent = text;
    span.onclick = onclick;
    return span;
  };

  // read filter
  let query = document.querySelector('#filter');
  let filter = query.value ? fi.compile(query.value) : function(){ return true; };

  // incrementally assemble missing parts of graph while generating tree
  // let graph = { nodes: [], links: [] };
  interfaces = [];
  nodeMap = {};
  let prevNode = null;
  let prevItem = null;
  env.nodes.forEach(n => {
    nodeMap[n.id] = n;
    assert(n.category != sk.NODE_INTERFACE, 'Interface node conflict');

    // add node to graph if not there
    sg.addNode(n);

    // do not show anchors if they are linked to a parent
    if(n.category == sk.NODE_ANCHOR && n.parent)
      return;

    // HTML parent
    let parent = domParent[n.id] || skel;
    // create element
    let item = document.createElement('li');
    item.dataset.node = n;
    item.classList.add(n.category);
    item.id = 'node-' + n.id;
    item.classList.add('node-' + n.id);
    if(n.type)
      item.classList.add(n.type);
    item.appendChild(newSpan('name', n.name + ' #' + n.id, selectNode.bind(null, n, self)));
    if(prevNode){
      item.appendChild(newSpan('moveup', '^', moveNode.bind(null, n, prevNode, -1)));
      // find 'delete'
      let remove = null;
      for(let i = 0; i < prevItem.children.length; ++i){
        if(prevItem.children[i].classList.contains('delete')){
          remove = prevItem.children[i];
          break;
        }
      }
      prevItem.insertBefore(newSpan('movedown', 'v', moveNode.bind(null, prevNode, n, +1)), remove);
    }
    item.appendChild(newSpan('delete', '-', deleteNode.bind(null, n)));

    // add interfaces
    let interfaceList = document.createElement('ul');
    interfaceList.classList.add('interfaces');
    n.getInterfaces().forEach(function(itf){

      // register interface
      if(!(itf.id in nodeMap)){
        interfaces.push(itf);
        nodeMap[itf.id] = itf;
        // add to graph if connected
        sg.addLink(itf);
      }

      // create slot
      let li = document.createElement('li');
      let thisNode = itf.thisSide(n).node;
      // use path from node or anchor
      // node (n==thisNode) or anchor (n!=thisNode)
      let path = itf.pathOf(thisNode);

      // simplify path name
      let pathName = path;
      let prefixes = [
        { before: 'branches/', after: 'b' },
        { before: 'sides/',    after: '' }
      ];
      prefixes.forEach(p => {
        let idx = pathName.indexOf(p.before);
        if(idx >= 0)
          pathName = pathName.replace(p.before, p.after);
      });
      li.textContent = pathName;
      li.classList.add(itf.state);
      li.classList.add('node-' + itf.id);
      // feedback
      if(selectedInterface && itf.id == selectedInterface.id){
        li.classList.add('inter-current');
      }
      // add class for connection's category
      let otherSide = itf.otherSide(n);
      if(otherSide){
        li.classList.add('to-' + otherSide.node.category);

        // add hover highlight
        li.onmouseenter = () => {
          highlight('.node-' + itf.id);
        };
        li.onmouseleave = () => {
          unhighlight('.node-' + itf.id);
        };
      }
      // add class if source is an anchor
      if(thisNode.category == sk.NODE_ANCHOR){
        
        // add special connection to parent
        sg.addAnchor(thisNode);
        
        li.classList.add('from-anchor');
        // fix path
        path = itf.pathOf(thisNode);
        li.textContent = path;
        // add special node for anchor before interface
        li.appendChild(newSpan(
            ['anchor', 'node-' + thisNode.id],
            thisNode.name + ' #' + thisNode.id,
            selectNode.bind(null, thisNode, self)
        ));
        // add destructor
        li.appendChild(newSpan('anchor-remove', 'x', function(){
          n.removeAnchor(thisNode);
          // XXX do that within env, not here!
          env.nodes = env.nodes.filter(n => n.id != thisNode.id);
          renderSkeleton(true);
        }));
      }

      // add selection interaction (corrected path)
      li.onclick = function(event){
        if(event.target == li)
          selectInterface(itf, { node: n, path: path });
      };

      interfaceList.appendChild(li);
    });
    item.appendChild(interfaceList);

    // add + create button (for anchors)
    if(n.category == sk.NODE_SHEET){
      let createAnchor = document.createElement('a');
      createAnchor.classList.add('create');
      createAnchor.classList.add('create-anchor');
      createAnchor.textContent = '+';
      createAnchor.onclick = function(){
        let anc = n.createAnchor('anchor');
        env.nodes.push(anc);
        renderSkeleton(true);
      };
      item.appendChild(createAnchor);
    }

    // do not include in list depending on filter
    if(!filter(n)){
      return;
    } 

    // finally append item
    parent.appendChild(item);
  });

  // add parameters
  for(let up of Parameter.getUserParameters()){
    let item = document.createElement('li');
    item.dataset.param = up;
    item.id = 'param-' + up.name;
    item.classList.add('param');
    item.classList.add('node-' + up.name);
    item.appendChild(newSpan('name', up.name));
    let input = document.createElement('input');
    input.type = 'text';
    input.value = up.value;
    input.onchange = function(){
      up.update(input.value);
      // re-render
      renderSkeleton(true);
    };
    item.onmouseenter = function() {
      for(let ref of up.references){
        let tag;
        if(ref.context)
          tag = document.getElementById('node-' + ref.context.id);
        else
          tag = document.getElementById('param-' + ref.name);
        tag.classList.add('graph-current');
      }
    };
    item.onmouseleave = function() {
      for(let ref of up.references){
        let tag;
        if(ref.context)
          tag = document.getElementById('node-' + ref.context.id);
        else
          tag = document.getElementById('param-' + ref.name);
        tag.classList.remove('graph-current');
      }
    };
    item.appendChild(input);
    if(!up.references.size){
      item.classList.add('noref');
      item.appendChild(newSpan('delete', 'x', () => {
        Parameter.removeUserParameter(up.name);
        renderSkeleton();
      }));
    }
    skel.appendChild(item);
    sg.addParam(up);
  }

  if(updateGraph){
    sg.render();
    sg.onClick(n => {
      selectNode(nodeMap[n.id], renderSkeleton);
    });

    // update output
    updateOutput(resetOutput);
  } else {
    sg.centerGraph();
  }
}

function highlight(selector){
  unhighlight();
  document.querySelectorAll(selector).forEach(el => {
    el.classList.add('graph-current');
  });
}

function unhighlight(selector){
  if(!selector)
    selector = '#skeleton .graph-current'; // all current selection
  document.querySelectorAll(selector).forEach(el => {
    el.classList.remove('graph-current');
  });
}

function initCategories(){
  if(catInit)
    return;
  catInit = true;

  let select = document.querySelector('#create_category');
  while(select.firstChild)
    select.removeChild(select.firstChild);
  [sk.NODE_SHEET, sk.NODE_JOINT, sk.NODE_SPLIT].forEach(c => {
    let option = document.createElement('option');
    option.value = c;
    option.textContent = c;
    select.appendChild(option);
  });

  // set interaction
  let create = document.querySelector('#create');
  create.onclick = function(){
    let cat = select.value;
    createNode(cat);
  };
}

function createNode(category, params, onlyReturn){
  let node = new sk.typeMap[category]();
  // set extra properties
  if(params){
    for(let name in params)
      node[name] = params[name];
  }
  env.nodes.push(node);

  // if third parameter, do not update UI yet
  if(onlyReturn)
    return node;

  // update UI
  renderSkeleton(true);
  // select new node
  let last = env.nodes[env.nodes.length-1];
  assert(last && node == last, 'Zombie node?');

  // select node
  selectNode(last, renderSkeleton);
  return node;
}

function deleteNode(node){
  assert(node.category != sk.NODE_INTERFACE, 'Delete not for interfaces');
  // disconnect all interfaces
  node.getInterfaces().forEach(itf => {
    itf.disconnect();
  });
  // delete all anchors if any
  let anchors = (node.anchors || []).slice();
  anchors.forEach(anchor => {
    node.removeAnchor(anchor);
  });
  // filter nodes
  env.removeNode(node);
  // re-render
  renderSkeleton(true);
}

function moveNode(source, target, dir){
  let srcIdx = -1;
  let trgIdx = -1;
  for(let i = 0; i < env.nodes.length; ++i){
    if(source.id == env.nodes[i].id){
      srcIdx = i;
    }
    if(target.id == env.nodes[i].id){
      trgIdx = i;
    }
  }
  assert(srcIdx >= 0 || trgIdx >= 0, 'Invalid nodes ' + source + ' or ' + target);
  env.nodes.splice(srcIdx, 1);
  let shift = trgIdx > srcIdx ? -1 : 0;
  env.nodes.splice(trgIdx + shift + Math.max(0, dir), 0, source);
  // re-render skeleton
  renderSkeleton();
}

function selectInterface(inter, side){
  if(!inter) {
    selectedInterface = null;
    selectedSide = null;
  } else if(selectedInterface){
    if(selectedInterface.id == inter.id){
      inter.disconnect();
    } else if(selectedInterface.id != inter.id){
      // check whether we can actually connect
      /*
      if(selectedInterface.isConnected())
        selectedInterface.disconnect();
      if(inter.isConnected())
        inter.disconnect();
      // TODO check it's a valid connection
      */
      selectedInterface.connectTo(inter); // will do nothing if invalid
    } // else do nothing
    selectedInterface = null;
  } else {
    // fresh selection
    selectedInterface = inter;
    selectedSide = side;
  }
  // update UI information
  renderSkeleton(true);
}

function loadSkeleton(blob, callback){
  let reader = new FileReader();
  reader.onload = function(event){
    let data = JSON.parse(event.target.result);
    if(!data)
      return;

    // load JSON data into new skeleton
    if(Array.isArray(data) && data.length){

      // load pure skeleton into environment
      env.resetGlobal();
      env.loadSkeleton(data);

    } else if('skeleton' in data){

      // load skeleton with global information
      // - global variables
      // - resources
      // - ui parameters
      env.resetGlobal();
      env.load(data);

      // try to update the pattern store
      // before re-rendering since it may be needed
      Pattern.preload().then(() => {
        renderSkeleton(true, true);
        if(callback)
          callback();
      });
      return;

    } else {
      // invalid skeleton data
      return;
    }

    // update display
    renderSkeleton(true, true);

    if(callback){
      callback();
    }
  };
  reader.readAsText(blob);
}

module.exports = {
  createNode, deleteNode, loadSkeleton, renderSkeleton
};
