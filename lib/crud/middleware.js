'use strict';

const mongoose = require('mongoose');
const obj = require('iblokz/common/obj');

const queryOp = {
	sort: (query, val) => query.sort(val),
	project: (query, val) => query.project(val),
	populate: (query, val) => query.populate(val),
	start: (query, val) => query.skip(val - 1),
	limit: (query, val) => val > 0 && query.limit(val) || query
};

const parseHook = (doc, req, prefs, meta) =>
	(obj.sub(meta, ['hook', 'hostParam']) && req.params[meta['hook']['hostParam']] && meta['hook']['linkField'])
		? obj.patch(doc, meta['hook']['linkField'],
			(prefs.schema[meta['hook']['linkField']] === 'ObjectId')
				? mongoose.Types.ObjectId(req.params[meta['hook']['hostParam']])
				: req.params[meta['hook']['hostParam']]
			)
		: doc;

const prepareSearch = (req, prefs, meta) => {
	let match = {};
	var search = req.query.search;
	var searchRegEx = new RegExp(search.toLowerCase(), 'i');

	if (req.query.searchField
		&& req.query.searchField !== ''
		&& prefs.searchable.indexOf(req.query.searchField) > -1) {
		match[req.query.searchField] = {$regex: searchRegEx};
	} else {
		match['$or'] = [];
		for (var i in prefs.searchable) {
			var queryObj = {};
			queryObj[prefs.searchable[i]] = {$regex: searchRegEx};
			match['$or'].push(queryObj);
		}
	}
	return match;
};

const prepareMatch = (req, prefs, meta) =>
	parseHook(Object.assign({},
		// created by
		req.query.createdBy ? {createdBy: req.query.createdBy} : {},
		// search
		(prefs.searchable && req.query.search) ? prepareSearch(req, prefs, meta) : {},
		// query filters
		prefs.schema ? Object.keys(prefs.schema).reduce((o, field) =>
			req.query[field] && !(req.query.searchField === field)
				? obj.patch(o, field, req.query[field])
				: o,
		{}) : {},
		// meta filters
		meta.filters ? Object.keys(meta.filters).reduce((o, field) =>
			obj.patch(o, field, meta.filters[field]),
		{}) : {}
	), req, prefs, meta);

// collection
const list = Store => (prefs, meta) =>
	(req, res) =>
		[{
			match: prepareMatch(req, prefs, meta),
			start: req.query.start || 1,
			limit: req.query.limit || 10,
			populate: meta['populate'] || [],
			project: meta['project'] || false
		}].map(params =>
			Store.count(params.match || {}).exec()
				.then(total =>
					// query chain
					Object.keys(params).reduce((query, op) =>
						(params[op] && queryOp[op] && queryOp[op](query, params[op]) || query),
						Store.find(params.match || {}))
						.exec()
						.then(list => ({
							total,
							start: params.start,
							limit: params.limit,
							list
						}))
				)
			)
		.pop().then(
			result => res.json(result),
			error => res.status(500).json(error)
		);

const create = Store => (prefs, meta) =>
	(req, res) =>
		Store.create(
			parseHook(Object.assign({},
				req.body,
				(req.user && req.user._id) ? {createdBy: req.user._id} : {}
			), req, prefs, meta)
		)
			.then(
				store => res.json(store),
				err => res.status(500).json(err)
			);

// document
const read = Store =>
	(req, res) => res.json(req.store[Store.modelName.toLowerCase()]);

const update = Store =>
	(req, res) =>
		(!req.store[Store.modelName.toLowerCase()] && req.body['_id'])
			? Store.findById(req.body['_id']).then(store =>
				(Object.assign(store, req.body)).save())
			: (Object.assign(req.store[Store.modelName.toLowerCase()], req.body)).save()
		.then(
			store => res.json(store),
			err => res.status(500).json(err)
		);

const _delete = Store =>
	(req, res) =>
		req.store[Store.modelName.toLowerCase()]
		.remove()
		.then(
			store => res.json(store),
			err => res.status(500).json(err)
		);

const idParam = Store =>
	(req, res, next, id) =>
		Store.findById(id).then(
			store => {
				req.store = req.store || {};
				req.store[Store.modelName.toLowerCase()] = store;
				next();
			},
			err => next(err)
		);

const init = (model, db = mongoose) => ({
	list: list(db.model(model)),
	create: create(db.model(model)),
	read: read(db.model(model)),
	update: update(db.model(model)),
	delete: _delete(db.model(model)),
	idParam: idParam(db.model(model))
});

module.exports = {
	init,
	list,
	create,
	read,
	update,
	delete: _delete,
	idParam
};