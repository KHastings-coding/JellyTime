import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableMinutes, settleCarry, applyDebtMode } from '../src/accounting.js';

const cases = [
  { name: 'earned left, allotment used',      daily: 30, carryIn: 0,   net: 40,      used: 50, carry: 20 },
  { name: 'earned untouched',                  daily: 30, carryIn: 0,   net: 40,      used: 10, carry: 40 },
  { name: 'user example: 10 earned left, -20', daily: 30, carryIn: 0,   net: 10 - 20, used: 30, carry: -10 },
  { name: 'removal absorbed by unwatched day', daily: 30, carryIn: 0,   net: -20,     used: 0,  carry: 0 },
  { name: 'removal absorbed, partly watched',  daily: 30, carryIn: 0,   net: -20,     used: 10, carry: 0 },
  { name: 'earned spent then big removal',     daily: 30, carryIn: 0,   net: 20 - 30, used: 45, carry: -25 },
  { name: 'big debt, carry mode',              daily: 30, carryIn: -50, net: 0,       used: 0,  carry: -20 },
  { name: 'big debt, forgive mode (clamped)',  daily: 30, carryIn: -30, net: 0,       used: 0,  carry: 0 },
  { name: 'bank cap 60',                       daily: 30, carryIn: 50,  net: 40,      used: 30, carry: 60, bankCap: 60 },
];

for (const c of cases) {
  test(`settleCarry: ${c.name}`, () => {
    assert.equal(settleCarry({ daily: c.daily, carryIn: c.carryIn, net: c.net, used: c.used, bankCap: c.bankCap ?? null }), c.carry);
  });
}

test('user example: next day starts 10 short', () => {
  const carry = settleCarry({ daily: 30, carryIn: 0, net: -10, used: 30 });
  assert.equal(availableMinutes({ daily: 30, carryIn: applyDebtMode(carry, 'carry', 30), net: 0, used: 0 }), 20);
});

test('applyDebtMode', () => {
  assert.equal(applyDebtMode(-50, 'carry', 30), -50);
  assert.equal(applyDebtMode(-50, 'forgive', 30), -30);
  assert.equal(applyDebtMode(-10, 'forgive', 30), -10);
  assert.equal(applyDebtMode(25, 'forgive', 30), 25);
});

test('bank cap never raises debt and 0 cap banks nothing', () => {
  assert.equal(settleCarry({ daily: 30, carryIn: 0, net: -40, used: 0, bankCap: 0 }), -10);
  assert.equal(settleCarry({ daily: 30, carryIn: 0, net: 40, used: 0, bankCap: 0 }), 0);
});

test('fractional minutes are preserved', () => {
  assert.equal(availableMinutes({ daily: 30, carryIn: 0, net: 0, used: 12.5 }), 17.5);
});
