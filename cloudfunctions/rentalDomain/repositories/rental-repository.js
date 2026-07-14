function createRepository(db) {
  async function queryAll(collection, where = {}, orderBy) {
    const rows = []
    let offset = 0
    while (true) {
      let query = db.collection(collection)
      if (Object.keys(where).length) query = query.where(where)
      if (orderBy) query = query.orderBy(orderBy.field, orderBy.direction)
      const res = await query.skip(offset).limit(100).get()
      const page = res.data || []
      rows.push(...page)
      if (page.length < 100) break
      offset += page.length
    }
    return rows
  }

  async function byId(collection, id) {
    const rows = await queryAll(collection, { _id: id })
    return rows[0] || null
  }

  function forOwner(openId) {
    function ownedWhere(where = {}) {
      return { ...where, _openid: openId }
    }

    return {
      queryAll(collection, where = {}, orderBy) {
        return queryAll(collection, ownedWhere(where), orderBy)
      },
      byId(collection, id) {
        return queryAll(collection, ownedWhere({ _id: id })).then(rows => rows[0] || null)
      }
    }
  }

  return { queryAll, byId, forOwner }
}

module.exports = { createRepository }
