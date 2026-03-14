const html = require('fs').readFileSync('trade2.html', 'utf8');
const filtersMatch = html.match(/trade_filters[^}]*}/g);
console.log(filtersMatch ? filtersMatch.join('\n') : 'no filters');
const allIds = [...html.matchAll(/"id":"([^"]+)"/g)].map((x) => x[1]);
console.log(allIds.filter((id) => id.includes('trade')));
