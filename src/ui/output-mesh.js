// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// - modules
const ForceGraph = require('force-graph');
const assert = require('../assert.js');
const { Action } = require('../ir.js');
const { hexColor, patternColor } = require('./colors.js');
const ContextMenu = require('./contextmenu.js');

// - constants
const spaceX = 100; // average L2 links is ~100, L1 is ~190
const spaceY = 100;
const bedSpaceX = 10;
const bedSpaceY = 10;

// data
let layout = null;

function MeshLayout(container){
  this.container = container;
  // register pattern update
  // registerUpdateCallback('mesh', () => {
  // updatePattern(); // (shapes, graph);
  // });
  // create force-graph layout
  let fg = this.graph = ForceGraph()(container);
  this.graphData = this.resetData();

  // fixed settings
  fg.backgroundColor('#eee')
    .linkWidth(5)
    .nodeRelSize(7);
  // force settings
  fg.d3AlphaDecay(0.0128) // 0.0228);
    .d3VelocityDecay(0.1); // 05);
  let charge = fg.d3Force('charge');
  charge.strength(-20);
  charge.distanceMax(1000);
  // g.d3Force('link').strength(10);

  // node hover
  fg.onNodeHover(node => {
    container.style.cursor = node ? '-webkit-grab' : null;
  });

  // side change
  let outputType = document.getElementById('output_type');
  let sideMode = document.getElementById('sideMode');
  sideMode.addEventListener('change', () => {
    if(outputType.value == 'mesh')
      this.updateData();
  });

  // mouse location
  this.clientX = 0;
  this.clientY = 0;
  container.querySelector('canvas').addEventListener('mousemove', event => {
    this.clientX = event.clientX;
    this.clientY = event.clientY;
  });

  // context menu
  this.menu = new ContextMenu([ 'Skeleton Menu' ]);
  fg.onNodeRightClick(node => {
    this.highlight = [];
    this.selection = [ node.group.parent ];
    this.targetIndex = node.index;
    this.targetTime = node.time;
    this.menu.reload(this.singleActions(node.group.parent));
    this.menu.show({
      clientX: this.clientX, clientY: this.clientY,
      preventDefault: function(){}
    });
  });
  container.querySelector('canvas').addEventListener('contextmenu', event => {
    event.preventDefault();
    /*
    this.menu.reload(this.globalActions());
    this.menu.show(event);
    */
  });

  this.resetSize();
}

MeshLayout.prototype.resetSize = function(){
  this.graph.width(this.container.clientWidth);
  this.graph.height(this.container.clientHeight);
};

MeshLayout.prototype.nodeID = function (shape, crsId, groupNeedle){
  const { index, side = 0 } = groupNeedle;
  return [shape.node.id, crsId, index, side].join('/');
};

MeshLayout.prototype.linkID = function(n1, n2){
  return [n1, n2].sort().join('@');
};

MeshLayout.prototype.resetData = function(){
  this.graphData = { nodes: [], links: [], nodeMap: {}, linkMap: {}, stitchMap: {}, gen: 0 };
  return this.graphData;
};

MeshLayout.prototype.updateData = function(tnb, reset){
  if(!tnb){
    tnb = this.data;
    if(!tnb)
      return;
  } else {
    this.data = tnb; // for context menu
  }
  const data = reset ? this.resetData() : this.graphData;
  // increase generation
  data.gen += 1;
  data.stitchMap = {}; // clear sitch map as it will change completely
  data.links = [];
  data.linkMap = {};

  const sides = document.getElementById('sideMode').value.split('-').map(str => {
    return str == 'front' ? 0 : 1;
  });

  // update graph data
  for(let t = 0; t < tnb.length; ++t){
    const nbed = tnb.timeline[t];
    const next = nbed.next();
    for(let stitch of nbed.stitches()){ // let i = 0; i < nbed.stitches.length; ++i){
      // const stitch = nbed.stitches[i];
      const { index, side } = nbed.needleOf(stitch);
      if(!sides.includes(side))
        continue; // skip
      if(nbed.isSuspended(stitch)){
        if(!(stitch.id in data.stitchMap))
          continue;
        // looking for additional wales to non-suspended bed
        if(next.hasStitch(stitch))
          continue; // still suspended
        for(let waleStitch of stitch.wales){
          if(!next.hasStitch(waleStitch)) //  || next.isSuspended(waleStitch))
            continue;
          let lid = this.linkID(stitch.id, waleStitch.id);
          let link = data.linkMap = {
            id: lid, source: stitch.id, target: waleStitch.id
          };
          data.links.push(link);
        }
        continue;
      }
      const grp = nbed.stitchPtr[stitch.id];
      const { shape, crsId } = grp;
      assert(shape, 'Non-suspended stitch without shape');
      const nid = this.nodeID(shape, crsId, grp.needleOf(stitch)); // grp.stitchMap[stitch.id]);
      let node;
      if(nid in data.nodeMap){
        node = data.nodeMap[nid];
      } else {
        // set initial position using compact layout needle
        data.nodeMap[nid] = node = {
          id: nid,
          x: index * spaceX + side * bedSpaceX,
          y: -t * spaceY - side * bedSpaceY,
          vx: 0,
          vy: 0,
          // bed information
          group: grp, time: t, index
        };
        data.nodes.push(node);
      }

      // register stitch with node
      node.gen = data.gen;
      node.stitch = stitch;
      data.stitchMap[stitch.id] = node;

      // set color
      node.sided = sides.indexOf(side);
      node.color = stitch.mark ? hexColor(stitch.mark, node.sided) : patternColor(stitch.pattern, node.sided);
      const action = nbed.actionMap[stitch.id];
      node.val = action.regular ? 7 : 12; // highlight irregular nodes

      // go over courses
      for(let crsStitch of stitch.courses){
        if(crsStitch.id in data.stitchMap){
          let lid = this.linkID(stitch.id, crsStitch.id);
          let link = data.linkMap[lid] = {
            id: lid, source: stitch.id, target: crsStitch.id
          };
          data.links.push(link);
        }
      }

      // go over action targets for primary wale links
      for(let j = 0; j < action.targets.length; ++j){
        const { index: nidx, side: nside } = action.targets[j];
        let stitches = next.beds[nside][nidx];
        if(!stitches)
          continue;
        if(!Array.isArray(stitches))
          stitches = [ stitches ];
        for(let waleStitch of stitches){
          if(waleStitch.id == stitch.id)
            continue; // skip suspension connection
          let lid = this.linkID(stitch.id, waleStitch.id);
          let link = data.linkMap[lid] = {
            id: lid, source: stitch.id, target: waleStitch.id
          };
          data.links.push(link);
        } // endfor waleStitch
      } // endfor j < actions.targets.length

      // use simulated back flow for secondary wales
      const backFlow = nbed.states[side][index];
      if(!backFlow || action.action == Action.MISS)
        continue;
      let isTuck = action.action = Action.TUCK;
      for(let j = 0; j < backFlow.pointers.length; ++j){
        let { stitch: waleStitch } = backFlow.pointers[j];
        // get wale link at least
        let lid = this.linkID(stitch.id, waleStitch.id);
        if(lid in data.linkMap)
          continue; // already processed (maybe from primary wales)
        let link = data.linkMap[lid] = {
          id: lid, source: stitch.id, target: waleStitch.id, num: j
        };
        data.links.push(link);
        // if tuck, then also gather courses
        if(!isTuck){
          let pastAction = data.stitchMap[waleStitch.id].actionMap[waleStitch.id];
          isTuck = pastAction.action == Action.TUCK;
          // XXX what if things get more complicated? (tuck over miss over knit+splitted)
          // XXX is this correct at all?
        }
        if(isTuck){
          for(let courseStitch of waleStitch.courses){
            lid = this.linkID(stitch.id, courseStitch.id);
            link = data.linkMap[lid] = {
              id: lid, source: stitch.id, target: courseStitch.id, num: j + 1
            };
          }
        }
      } //endfor j < backFlow length
    } // endfor i < #stitches
  } // endfor t

  // filter links that are missing their target (because of side being hidden)
  data.links = data.links.filter(({source, target}) => source in data.stitchMap && target in data.stitchMap);
  // convert links so that they point to the correct nodes
  data.links.forEach(link => {
    link.source = data.stitchMap[link.source];
    link.target = data.stitchMap[link.target];
    let { source, target, num = 0 } = link;
    if(source.sided == 0 && target.sided == 0){
      if(source.color == target.color)
        link.color = source.color;
      else
        link.color = 'rgba(50, 50, 50, ' + (1 / (num + 1)) + ')';
    } else {
      link.color = 'rgba(200, 200, 200, 0.5)';
    }
  });
  // order to ensure back/front layers
  if(sides.length > 1){
    data.links.sort((l1, l2) => {
      let r1 = l1.source.sided + l1.target.sided;
      let r2 = l2.source.sided + l2.target.sided;
      return r2 - r1;
    });
  }

  // prune old data
  data.nodes = data.nodes.filter(n => n.gen == data.gen);
  data.nodeMap = data.nodes.reduce((nodeMap, node) => {
    nodeMap[node.id] = node;
    return nodeMap;
  }, {});

  // update layout data
  this.resetSize();
  this.graph.graphData(data);

  // reset location
  if(reset)
    this.graph.centerAt(0, 0);
};

// extend with menu from base layout
Object.assign(MeshLayout.prototype, require('./output-layout-menu.js'));

function drawMesh(tnb, resetOutput){

  if(!layout){
    let container = document.getElementById('output-mesh');
    layout = new MeshLayout(container);
  }
  // update data
  tnb.simulate();
  layout.updateData(tnb.compact(true), resetOutput);
}

module.exports = { drawMesh };
