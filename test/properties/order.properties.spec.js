const fc = require('fast-check');

const { subtotal } = require('../../src/subtotal');
const { discounts } = require('../../src/discounts');
const { total } = require('../../src/total');
const { tax } = require('../../src/tax');
const { deliveryFee } = require('../../src/delivery');

// These arbitrary generators provide primitive building blocks for constructing orders and contexts in property-based tests
//
// To learn more about primitives: https://fast-check.dev/docs/core-blocks/arbitraries/primitives
// To learn more about combiners: https://fast-check.dev/docs/core-blocks/arbitraries/combiners
const skuArb = fc.constantFrom('P6-POTATO', 'P12-POTATO', 'P24-POTATO', 'P6-SAUER', 'P12-SAUER');
const addOnArb = fc.constantFrom('sour-cream', 'fried-onion', 'bacon-bits');
const fillingArb = fc.constantFrom('potato', 'sauerkraut', 'sweet-cheese', 'mushroom');
const kindArb = fc.constantFrom('hot', 'frozen');
const tierArb = fc.constantFrom('guest', 'regular', 'vip');
const zoneArb = fc.constantFrom('local', 'outer');

// This composite arbitrary generator builds an order item object using the primitive building blocks defined above
// Each field in the object below specifies the arbitrary generator to use for that field
//
// To learn more about composite arbitraries: https://fast-check.dev/docs/core-blocks/arbitraries/composites
const orderItemArb = fc.record({
  // e.g., this will use the kindArb to generate a value for the 'kind' field
  kind: kindArb,
  sku: skuArb,
  title: fc.string(),
  filling: fillingArb,
  qty: fc.constantFrom(6, 12, 24),
  unitPriceCents: fc.integer({ min: 500, max: 3000 }),
  addOns: fc.array(addOnArb, { maxLength: 3 })
});

// We use the orderItemArb defined above to build an order object that contains an array of order items
const orderArb = fc.record({
  // we specify the maximum and minimum length of the items array here
  items: fc.array(orderItemArb, { minLength: 1, maxLength: 5 })
});


// ------------------------------------------------------------------------------
// To test discounts, tax, delivery and total, you will need to add more
// arbitraries to represent the context in which an order is placed.
//
// You will find the following building blocks helpful:
//
// fc.boolean() - to represent true/false flags
// fc.constantFrom(...) - to represent enumerated values
// fc.record({ ... }) - to build composite objects
// fc.optional(...) - to represent optional fields
// ------------------------------------------------------------------------------


describe('Property-Based Tests for Orders', () => {
  describe('Invariants', () => {
    
    // Here's an example preservation property!
    it('subtotal should always be non-negative integer', () => {
      fc.assert(
        fc.property(orderArb, (order) => {
          const result = subtotal(order);
          return result >= 0 && Number.isInteger(result);
        }),
        { numRuns: 50 }
      );
    });

    // ---------------------------------------------------------------------------
    // Add more invariant properties for discounts, tax, delivery, and total here
    // You can adapt the starter code below.
    // Feel free to copy, paste, and modify as needed multiple times.
    // ---------------------------------------------------------------------------

    // BUG: tax() never calculates tax for hot items. The loop in tax.js only
    // computes tax inside the `kind === 'frozen'` branch (which has a 0% rate),
    // while the `kind === 'hot'` branch merely sets a flag and skips the tax
    // calculation entirely. Hot items should be taxed at 8% per the spec.
    it('tax on an order with only hot items should be greater than zero', () => {
      const hotItemArb = fc.record({
        kind: fc.constant('hot'),
        sku: skuArb,
        title: fc.string(),
        filling: fillingArb,
        qty: fc.constantFrom(6, 12, 24),
        unitPriceCents: fc.integer({ min: 500, max: 3000 }),
        addOns: fc.array(addOnArb, { maxLength: 3 })
      });

      const hotOrderArb = fc.record({
        items: fc.array(hotItemArb, { minLength: 1, maxLength: 5 })
      });

      const deliveryArb = fc.record({
        zone: zoneArb,
        rush: fc.boolean()
      });

      fc.assert(
        fc.property(hotOrderArb, deliveryArb, (order, delivery) => {
          const result = tax(order, delivery);
          return result > 0;
        }),
        { numRuns: 50 }
      );
    });

    // BUG: deliveryFee() charges the base fee once per item instead of once per
    // order. The loop at delivery.js:60-66 iterates over order.items and adds
    // 399 or 699 for each item, so a 2-item order pays double delivery.
    // Property: non-rush delivery fee should never exceed the zone's base fee
    // (399 for local, 699 for outer) regardless of how many items are in the order.
    it('delivery fee should not exceed zone base fee for non-rush, non-free orders', () => {
      // Use small unitPriceCents so the order stays below the free-delivery threshold
      const cheapItemArb = fc.record({
        kind: kindArb,
        sku: skuArb,
        title: fc.string(),
        filling: fillingArb,
        qty: fc.constant(6),
        unitPriceCents: fc.integer({ min: 100, max: 300 }),
        addOns: fc.constant([])
      });

      const smallOrderArb = fc.record({
        items: fc.array(cheapItemArb, { minLength: 2, maxLength: 5 })
      });

      const deliveryArb = fc.record({
        zone: zoneArb,
        rush: fc.constant(false)
      });

      const profileArb = fc.record({
        tier: tierArb
      });

      fc.assert(
        fc.property(smallOrderArb, deliveryArb, profileArb, (order, del, profile) => {
          const result = deliveryFee(order, del, profile);
          const maxFee = del.zone === 'local' ? 399 : 699;
          return result <= maxFee;
        }),
        { numRuns: 50 }
      );
    });

    // BUG: total.js:57-61 corrupts order totals over 10000 cents ($100).
    // It converts to a formatted dollar string, appends "00", then parseInt()s
    // the result. e.g. 10001 → "100.01" → "100.0100" → parseInt → 100.
    // Property: total() should always return a non-negative integer and should
    // never be less than the subtotal minus discounts (i.e. the components
    // should add up, not get destroyed by formatting).
    it('total should be a non-negative integer consistent with its components', () => {
      const profileArb = fc.record({
        tier: tierArb
      });

      const deliveryArb = fc.record({
        zone: zoneArb,
        rush: fc.boolean()
      });

      const contextArb = fc.record({
        profile: profileArb,
        delivery: deliveryArb,
        coupon: fc.constant(null)
      });

      // Use higher prices to push totals above 10000 cents
      const expensiveItemArb = fc.record({
        kind: kindArb,
        sku: skuArb,
        title: fc.string(),
        filling: fillingArb,
        qty: fc.constant(24),
        unitPriceCents: fc.integer({ min: 2000, max: 3000 }),
        addOns: fc.array(addOnArb, { maxLength: 3 })
      });

      const expensiveOrderArb = fc.record({
        items: fc.array(expensiveItemArb, { minLength: 1, maxLength: 5 })
      });

      fc.assert(
        fc.property(expensiveOrderArb, contextArb, (order, context) => {
          const result = total(order, context);
          return Number.isInteger(result) && result >= 10000;
        }),
        { numRuns: 50 }
      );
    });

  });
});
