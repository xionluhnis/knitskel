// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// operators
const operators = {
  '?': function(n, key, value){
    return (key && key in n) || (value && value in n);
  },
  '!': function(n, key, value){
    if(!key)
      return !(key in n); // checking if not a key
    else
      return key in n && n[key] != value;
  },
  '~': function(n, key, value){
    return key in n && n[key].indexOf(value) >= 0;
  },
  '>=': function(n, key, value){
    return key in n && n[key] >= parseFloat(value);
  },
  '<=': function(n, key, value){
    return key in n && n[key] <= parseFloat(value);
  },
  '>': function(n, key, value){
    return key in n && n[key] > parseFloat(value);
  },
  '<': function(n, key, value){
    return key in n && n[key] < parseFloat(value);
  },
  '=': function(n, key, value){
    return key in n && n[key] == value;
  }
};
const list = Object.keys(operators);

// export
module.exports = Object.assign({
  list,
  compile: function(query){
    let normal = query.replace(/[,\+\t ]+/g, ' ').replace(/\s+/, ' ');
    let tokens = normal.split(' ');
    // XXX this does not allow string contexts
    let rules = tokens.map(function(token){
      for(let i = 0; i < list.length; ++i){
        let op = list[i];
        let idx = token.indexOf(op);
        if(idx >= 0){
          return {
            op, key: token.substr(0, idx), value: token.substr(idx+op.length)
          };
        }
      }
      // default is larger
      return { key: token };
    });
    return function(node){
      if(!node)
        return false;
      for(let i = 0; i < rules.length; ++i){
        let rule = rules[i];
        if('op' in rules[i]){
          if(!operators[rule.op](node, rule.key, rule.value))
            return false;
        } else {
          // special default operator
          let key = rule.key;
          if(!(key in node // key is a parameter
            || node.category.indexOf(key) >= 0 // key matches category
            || node.id.toString().indexOf(key) >= 0 // key matches id
            || (node.name || "").indexOf(key) >= 0 ) // key matches name
          ){
            return false;
          }
        }
      }
      return true;
    };
  }
}, operators);
