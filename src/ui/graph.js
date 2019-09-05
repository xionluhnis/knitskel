// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// - modules
const assert = require('../assert.js');
const ForceGraph = require('force-graph');
const { nodeColor } = require('./colors.js');

// - data structure
let graph = { nodes: [], links: [] };
let graphNodes = {};
let graphLinks = {};
let graphGen = 0;
let g = null;

function highlightGraphNode(node){
  document.querySelectorAll('#skeleton .graph-current').forEach(el => {
    el.classList.remove('graph-current');
  });
  if(!node)
    return;
  let nodeID = node.id.toString().replace('-parent', '');
  if(nodeID.charAt(0) == '#'){
    nodeID = nodeID.substr(1);
    if(nodeID.includes('#')){
      // parameter link
      return;
    }
    // else parameter
  }
  let selector = '#skeleton .node-' + nodeID;
  document.querySelectorAll(selector).forEach(el => {
    el.classList.add('graph-current');
  });
}

function addNode(n){
  let name = n.name + ' #' + n.id;
  if(!(n.id in graphNodes)){
    let node = {
      id: n.id, node: n, category: n.category, name, _gen: graphGen
    };
    graph.nodes.push(node);
    graphNodes[n.id] = node;
  } else {
    graphNodes[n.id].name = name;
    graphNodes[n.id]._gen = graphGen;
  }
}
function addParam(p){
  let id = '#' + p.name;
  let node;
  if(!(id in graphNodes)){
    node = {
      id, category: 'param',
      name: id + ' = ' + p.value,
      val: 0.5,
      _gen: graphGen
    };
    graph.nodes.push(node);
    graphNodes[id] = node;
  } else {
    node = graphNodes[id];
    node.name = id + ' = ' + p.value; // update as it may have changed
    node._gen = graphGen;
  }
  // ensure correct links
  for(let ref of p.references){
    let linkID;
    let target;
    let name;
    if(ref.context){
      // used in another node
      linkID = id + ' <- #' + ref.context.id + '/' + ref.name;
      target = ref.context.id;
      name = '#' + ref.context.id + '/' + ref.name + ' = ' + ref.value;
    } else {
      // used in another parameter
      linkID = id + ' <- #' + ref.name;
      target = '#' + ref.name;
      name = target + ' = ' + ref.value;
    }
    if(!(linkID in graphLinks)){
      let link = {
        id: linkID,
        source: node,
        target: (graphNodes[target] || target),
        name,
        _gen: graphGen,
        color: 'rgba(255, 255, 255, 0.3)'
      };
      graph.links.push(link);
      graphLinks[linkID] = link;
    } else {
      graphLinks[linkID].name = name; // update as it may have changed
      graphLinks[linkID]._gen = graphGen;
    }
  }
}
function addLink(itf){
  if(!itf.isConnected())
    return; // skip
  let name = '#' + itf.sides[0].node.id + '/' + itf.sides[0].path +
          ' - #' + itf.sides[1].node.id + '/' + itf.sides[1].path;
  if(!(itf.id in graphLinks)){
    let link = {
      id: itf.id,
      source: itf.sides[0].node.id,
      target: itf.sides[1].node.id,
      name, _gen: graphGen
    };
    graph.links.push(link);
    graphLinks[itf.id] = link;
  } else {
    graphLinks[itf.id].name = name;
    graphLinks[itf.id]._gen = graphGen;
  }
}
function addAnchor(anchor){
  assert(anchor.parent, 'Anchor is orphan: ' + anchor);
  let linkId = anchor.id + '-parent';
  let name = 'anchor #' + anchor.id + ' of #' + anchor.parent.id;
  if(!(linkId in graphLinks)){
    let link = {
      id: linkId,
      node: anchor,
      source: anchor.id,
      target: anchor.parent.id,
      name, _gen: graphGen
    };
    graph.links.push(link);
    graphLinks[linkId] = link;
  } else {
    graphLinks[linkId].name = name;
    graphLinks[linkId]._gen = graphGen;
  }
}

function render(){
  // remove old nodes and links
  graph.nodes = graph.nodes.filter(n => {
    if(n._gen == graphGen)
      return true;
    else {
      delete graphNodes[n.id];
      return false;
    }
  });
  graph.links = graph.links.filter(l => {
    if(l._gen == graphGen)
      return true;
    else {
      delete graphLinks[l.id];
      return false;
    }
  });
  
  // switch to new generation
  graphGen++;
  
  // graph interaction
  const NODE_R = 5;
  let hNodes = [];
  let hLink  = null;
  let elem = document.querySelector('#skeleton-graph');
  if(!g)
    g = ForceGraph()(elem).graphData(graph);
  else
    g.graphData(graph);
  // sizing
  elem.onresize = function(){
    g.width(elem.clientWidth || 280).height(elem.clientHeight || 200);
    g.centerAt(0, 0);
  };
  elem.onresize();
  // boundaries
  g.nodeRelSize(NODE_R).onNodeHover(node => {
    hNodes = node ? [node] : [];
    elem.style.cursor = node ? '-webkit-grab' : null;
    highlightGraphNode(node);
  }).onLinkHover(link => {
    hLink = link;
    hNodes = link ? [link.source, link.target] : [];
    highlightGraphNode(link);
  }).linkWidth(link => link == hLink ? 5 : 1)
    .linkDirectionalParticles(4)
    .linkDirectionalParticleWidth(link => link === hLink ? 4 : 0);
  g.nodeCanvasObject((node, ctx) => {
    let radius = NODE_R * (node.val || 1);
    if(hNodes.indexOf(node) !== -1){
      // selection ring
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius * 1.4, 0, 2 * Math.PI, false);
      ctx.fillStyle = '#F1FFAF'; // highlight
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = nodeColor(node); // '#0091FF';
    ctx.fill();
  });
  // update position to be at center
  g.centerAt(0, 0);
}

function centerGraph(){
  if(g)
    g.centerAt(0, 0);
}

function onClick(callback){
  g.onNodeClick(callback).onLinkClick(callback);
}

module.exports = {
  render, addNode, addParam, addLink, addAnchor, onClick, centerGraph
};
