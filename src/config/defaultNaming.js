/**
 * Default naming palette (Verdania fantasy)
 *
 * Built-in fallback when callers don't provide custom naming configuration.
 */

export const DEFAULT_NAMING = {
  settlement: {
    patterns: ['compound', 'possessive', 'descriptive'],
    weights: [0.40, 0.35, 0.25],
    roots: [
      'Willow', 'Oak', 'Ash', 'Thorn', 'Stone', 'Iron', 'Brook', 'Glen',
      'Elm', 'Birch', 'Moss', 'Fern', 'Copper', 'Hazel', 'Alder', 'Reed',
      'Briar', 'Cliff', 'Mist', 'Storm', 'Raven', 'Crane', 'Fox', 'Hare',
      'Silver', 'Gold', 'Amber', 'Flint', 'Slate', 'Wren',
    ],
    suffixes: [
      'ford', 'wick', 'holme', 'dale', 'mere', 'fell', 'stead', 'gate',
      'haven', 'ton', 'bridge', 'vale', 'moor', 'croft', 'field', 'wood',
      'marsh', 'reach', 'bury', 'holt',
    ],
    people: [
      'Miller', 'Smith', 'Cooper', 'Warden', 'Shepherd', 'Fletcher',
      'Mason', 'Thatcher', 'Brewer', 'Carter', 'Forester', 'Fisher',
      'Tinker', 'Chandler', 'Wainwright', 'Bowman',
    ],
    features: [
      'Rest', 'Crossing', 'Bridge', 'Well', 'Mill', 'Hall', 'Keep',
      'Landing', 'Watch', 'Hollow', 'Hearth', 'Lodge', 'Wharf', 'Market',
      'Green', 'End',
    ],
    descriptors: [
      'Old', 'Quiet', 'High', 'Low', 'Green', 'White', 'Dark', 'Long',
      'Far', 'Bright', 'Deep', 'Broad', 'North', 'South', 'East', 'West',
    ],
  },

  island: {
    patterns: ['name_isle', 'the_adjective_name', 'name'],
    names: [
      'Vern', 'Korth', 'Ash', 'Storm', 'Thorn', 'Dusk', 'Mire', 'Crest',
      'Gale', 'Stone', 'Frost', 'Briar', 'Wren', 'Drake', 'Fern',
    ],
    adjectives: [
      'Green', 'Iron', 'Shrouded', 'Lost', 'Golden', 'Ashen', 'Silent',
      'Sunken', 'Verdant', 'Wind-Swept',
    ],
  },

  river: {
    patterns: ['the_name_river', 'name'],
    names: [
      'Willow', 'Stone', 'Rush', 'Clear', 'White', 'Silver', 'Moss',
      'Amber', 'Swift', 'Deep', 'Bright', 'Still', 'Reed', 'Fern',
    ],
  },
};
