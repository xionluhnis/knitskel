// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

let UID = 0;

/**
 * Union-find data structure
 *
 * @param elem the element to represent
 */
function UnionSet(elem){
  this.parent = this;
  this.elem = elem;
  this.id = ++UID;
}
UnionSet.prototype.find = function(){
  if(this.parent != this)
    this.parent = this.parent.find();
  return this.parent;
};
UnionSet.prototype.union = function(uset){
  let troot = this.find();
  let oroot = uset.find();
  // check equality
  if(troot == oroot)
    return; // already equivalent
  else
    oroot.parent = troot; // merge trees by replacing the root of one
};
UnionSet.getClusters = function(usets){
  let clusters = [];
  let clusterMap = {};
  for(let uset of usets){
    if(uset.find().id in clusterMap){
      let clu = clusterMap[uset.find().id];
      clu.push(uset.elem);
    } else {
      let clu = [ uset.elem ];
      clusterMap[uset.find().id] = clu;
      clusters.push(clu);
    }
  }
  return clusters;
};

module.exports = UnionSet;
