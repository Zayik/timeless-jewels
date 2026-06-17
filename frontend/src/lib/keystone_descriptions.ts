/* eslint-disable array-bracket-newline -- generated data; Prettier owns wrapping */
// Timeless jewel keystone effect text, sourced from the PoE Wiki
// (passive_skills cargo table) on 2026-06-16. Most jewel keystones are not base
// tree nodes and carry only a name-marker stat in the shipped game data, so their
// mechanical text is not derivable at runtime. The conqueror legend prefers live
// skill-tree text when the keystone is a tree node and falls back to this map.
// Update if GGG rebalances a keystone.

export const KEYSTONE_DESCRIPTIONS: Record<string, string[]> = {
  'Black Scythe Training': [
    'Removes all Energy Shield',
    'Chance to Evade Hits is based off of 200% of your Ward instead of your Evasion Rating',
    'Physical Damage Reduction from Hits is based off of 200% of your Ward instead of your Armour'
  ],
  'Celestial Mathematics': [
    'While you have Unbroken Ward, your next non-channelling Attack you Use yourself breaks your Ward to gain Added Cold Damage equal to 25% of Ward'
  ],
  Chainbreaker: [
    'Mana Recovery from Regeneration is not applied',
    '1 Rage Regenerated for every 25 Mana Regeneration per Second',
    'Does not delay Inherent Loss of Rage',
    'Skills Cost +3 Rage'
  ],
  'Corrupted Soul': [
    '50% of Non-Chaos Damage taken bypasses Energy Shield',
    'Gain 15% of Maximum Life as Extra Maximum Energy Shield'
  ],
  'Dance with Death': [
    "Can't use Helmets",
    'Your Critical Strike Chance is Lucky',
    'Your Damage with Critical Strikes is Lucky',
    "Enemies' Damage with Critical Strikes against you is Lucky"
  ],
  'Divine Flesh': [
    'All Damage taken bypasses Energy Shield',
    '50% of Elemental Damage taken as Chaos Damage',
    '+5% to maximum Chaos Resistance'
  ],
  'Eternal Youth': [
    '50% less Life Regeneration Rate',
    '50% less maximum Total Life Recovery per Second from Leech',
    'Energy Shield Recharge instead applies to Life'
  ],
  'Glancing Blows': [
    'Chance to Block Attack Damage is doubled',
    'Chance to Block Spell Damage is doubled',
    'You take 65% of Damage from Blocked Hits'
  ],
  'Immortal Ambition': [
    'Energy Shield starts at zero',
    'Cannot Recharge or Regenerate Energy Shield',
    'Lose 5% of Energy Shield per second',
    'Life Leech effects are not removed when Unreserved Life is Filled',
    'Life Leech effects Recover Energy Shield instead while on Full Life'
  ],
  'Inner Conviction': ['3% more Spell Damage per Power Charge', 'Gain Power Charges instead of Frenzy Charges'],
  'Power of Purpose': ['80% of Maximum Mana is Converted to twice that much Armour'],
  'Second Sight': [
    'You are Blind',
    'Blind does not affect your Light Radius',
    '25% more Melee Critical Strike Chance while Blinded'
  ],
  'Strength of Blood': [
    'Life Recovery from Non-Instant Leech is not applied',
    '2% additional Physical Damage Reduction for every 3% Life Recovery per second from Leech'
  ],
  'Supreme Decadence': [
    'Life Recovery from Flasks also applies to Energy Shield',
    '30% less Life Recovery from Flasks'
  ],
  'Supreme Ego': [
    'Auras from your Skills can only affect you',
    'Aura Skills have 1% more Aura Effect per 2% of maximum Mana they Reserve',
    '40% more Mana Reservation of Aura Skills'
  ],
  'Supreme Grandstanding': [
    'Nearby Allies and Enemies Share Charges with you',
    'Enemies Hitting you have 10% chance to gain an Endurance, Frenzy or Power Charge'
  ],
  'Supreme Ostentation': ['Ignore Attribute Requirements', 'Gain no inherent bonuses from Attributes'],
  'Tempered by War': [
    '50% of Cold and Lightning Damage taken as Fire Damage',
    '50% less Cold Resistance',
    '50% less Lightning Resistance'
  ],
  'The Agnostic': [
    'Removes all Energy Shield',
    'While not on Full Life, Sacrifice 20% of Mana per Second to Recover that much Life'
  ],
  'The Traitor': ['Flasks Gain 4 Charges per empty Flask Slot every 5 seconds'],
  'The Unbreaking Circle': ['40% less Ward', 'Ward has a 60% chance to not Break'],
  Transcendence: [
    'Armour applies to Fire, Cold and Lightning Damage taken from Hits instead of Physical Damage',
    '-15% to all maximum Elemental Resistances'
  ],
  'Wind Dancer': [
    "20% less Attack Damage taken if you haven't been Hit by an Attack Recently",
    '10% more chance to Evade Attacks if you have been Hit by an Attack Recently',
    '20% more Attack Damage taken if you have been Hit by an Attack Recently'
  ]
};
