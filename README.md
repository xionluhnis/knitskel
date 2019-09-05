# Knitting Skeleton

This is the open source implementation of the paper
**Knitting Skeletons: Computer-Aided Design Tool for Shaping and Patterning of Knitted Garments**.

The project page is there:
[http://knitskel.csail.mit.edu/](http://knitskel.csail.mit.edu/)

Since the system is in a continuous work-in-progress state, there are likely going to be bugs or desirable features missing.
For bugs, file an issue here. For other inquiries, contact [Alexandre Kaspar](http://w-x.ch).

## Dependencies

The system is a web client written mostly in Javascript with some HTML/CSS layouts.
The Javascript development is made with [Node.js](https://nodejs.org/en/) and [Browserify](http://browserify.org/).

To install all dependencies, use [npm](https://www.npmjs.com/):
```
npm install
```

## Development

If you want to compile the system, you can use npm scripts:

* `npm run build` will output the full compiled code in `js/skeleton.js`
* `npm run watch` will use [watchify](https://github.com/browserify/watchify) to continuously update the code as code changes (while providing debugging information)

To check some basic test on provided skeletons, use

* `npm run test`

## Third party libraries

This project is making use of many third-party libraries for its development.
The notable ones are in the dependencies of `package.json`.
We are especially thankful to the following:

* [CodeMirror](https://codemirror.net/) for the in-browser code editing capabilities
* [Simplenoise](https://github.com/josephg/noisejs#readme) for the perlin/simplex noise implementations
* [Force-Graph](https://github.com/vasturiano/force-graph) for the easy force graph layout

## Credits

We want to thank our collaborators from [Jim McCann](https://github.com/ixchow)'s [Textiles Lab](https://textiles-lab.github.io/) at CMU.
They are the ones who initially deciphered the DAT format.

## Working with knitting machine XXX?

Currently, we've had the chance to work with a [Shima Seiki SWG091N2](https://www.shimaseiki.com/product/knit/swg_n2/) machine.
However, the system could likely work with more generally v-bed machines (provided there is a known way to output data for them).

A more general strategy would be to output [Knitout](https://github.com/textiles-lab/knitout/) code and use an available backend for your machine.
This is not done yet but should be reasonably easy to implement since our system outputs code for whole beds / courses at once, which is quite more regular than general Knitout code.

## Licensing

So far, most of the source code is the creation of [Alexandre Kaspar](http://w-x.ch).
Feel free to contact me if you have commercial interests.

As-is, you are free to use it for research purposes (or your own private purposes), but not commercially.

## References

If you make use of this software, we would be grateful if you can cite us:
```
@article{Kaspar19b,
  title = {Knitting Skeletons: Computer-Aided Design Tool for Shaping and Patterning of Knitted Garments},
  author = {Kaspar, Alexandre and Makatura, Liane and Matusik, Wojciech},
  journal = {Proceedings of the ACM Symposium on User Interface Software and Technology (UIST)},
  year = {2019},
  address = {New Orleans, Louisiana, USA}
  month = {20--23 Oct},
  isbn = {978-1-4503-6816-2/19/10}
}
```
