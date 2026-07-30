const CUISINE_CODES: Record<string, string> = {
  Italian: 'ITA',
  Indian: 'IND',
  Lebanese: 'LBN',
  Japanese: 'JPN',
  Turkish: 'TUR',
  American: 'USA',
  Seafood: 'SEA',
  Vegetarian: 'VEG',
  'Fast Food': 'FAST',
  Cafe: 'CAFE',
  Omani: 'OMN',
  Thai: 'THA',
};

export function cuisineCode(label: string) {
  return CUISINE_CODES[label] ?? label.slice(0, 4).toUpperCase();
}
