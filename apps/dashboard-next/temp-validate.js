const fs = require('fs');
const turf = require('@turf/turf');
const imbl = JSON.parse(fs.readFileSync('./public/data/imbl_boundary.json','utf8'));
console.log('imbl type', imbl.type, Array.isArray(imbl.features), imbl.features.length);
const lineFeature = imbl.features.find(f => f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString'));
console.log('first feature type', lineFeature && lineFeature.geometry.type, lineFeature && lineFeature.geometry.coordinates.length);
const offset = turf.lineOffset(lineFeature, -5, { units: 'kilometers' });
console.log('offset type', offset.type, offset.geometry.type, Array.isArray(offset.geometry.coordinates), offset.geometry.coordinates.length, Array.isArray(offset.geometry.coordinates[0]));
