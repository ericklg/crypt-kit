import type { FixtureRoute } from '@crypt-kit/core/testing';

/**
 * CheapShark responses recorded 2026-11-19 (Multiple Game Lookup for 612, 128 and 167910,
 * and the store list), trimmed to four deals per game and the stores they use.
 */
export const API = 'https://www.cheapshark.com/api/1.0';

export const recordedGames = {
  '128': {
    info: { title: 'BioShock', steamAppID: '7670' },
    cheapestPriceEver: { price: '3.50', date: 1792743769 },
    deals: [
      { storeID: '23', dealID: 'et8hm7BwoAPZnyJpSAAehTMKS7M1aPlbLKSZDWmUtEo%3D', price: '16.79', retailPrice: '19.99', savings: '16.008004' },
      { storeID: '27', dealID: 'sih7CO1qZ1vUrVB%2BuKVccW82zOPd37fOjCi07Y5ip4k%3D', price: '17.99', retailPrice: '19.99', savings: '10.005003' },
      { storeID: '1', dealID: '7OKT5vjgeNTOpZUf6NTct4pDEozvxfM3KwdevolT%2FCE%3D', price: '19.99', retailPrice: '19.99', savings: '0.000000' },
      { storeID: '2', dealID: 'DlT5IxXbqt4KI7VAOZVcrt1u%2BS9qYZQ16IY4cory4Cg%3D', price: '19.99', retailPrice: '19.99', savings: '0.000000' },
    ],
  },
  '612': {
    info: { title: 'LEGO Batman', steamAppID: null },
    cheapestPriceEver: { price: '2.28', date: 1759177295 },
    deals: [
      { storeID: '21', dealID: 'Dtzv5PHBf71720cIYjxx3oHvvZK3iHUbQjv6fWLVpd8%3D', price: '2.99', retailPrice: '19.99', savings: '85.042521' },
      { storeID: '23', dealID: 'tyTH88J0PXRvYALBjV3cNHd5Juq1qKcu4tG4lBiUCt4%3D', price: '16.54', retailPrice: '19.99', savings: '17.258629' },
      { storeID: '15', dealID: '0f%2B4gT2VVUn4UcmFzPxXnuqoXKAOYoJ5mpFZRWNyohc%3D', price: '18.99', retailPrice: '19.99', savings: '5.002501' },
    ],
  },
  '167910': {
    info: { title: 'Batman: Arkham VR', steamAppID: '502820' },
    cheapestPriceEver: { price: '2.19', date: 1763677332 },
    deals: [
      { storeID: '21', dealID: 'y7nEC%2FMdMa4myBUYqzJ%2BN09pUxao0wE%2FOOLHOmEAmCM%3D', price: '2.99', retailPrice: '19.99', savings: '85.042521' },
      { storeID: '23', dealID: 'duswFlPNu%2B0QtHl5kEcEA%2BVFeNFm2CAuPOkaTx6nS3g%3D', price: '16.54', retailPrice: '19.99', savings: '17.258629' },
      { storeID: '27', dealID: '%2F8EPOz0BuWW%2BjeEXm84xM7R%2ByPnNVlu3A2poW4BgFs8%3D', price: '17.99', retailPrice: '19.99', savings: '10.005003' },
      { storeID: '15', dealID: 'VcpkOmgsL8LmPiKN7%2BzVQm1g4xi%2B0dXAk3fMyi%2B6Xnw%3D', price: '18.99', retailPrice: '19.99', savings: '5.002501' },
    ],
  },
};

export const recordedStores = [
  { storeID: '1', storeName: 'Steam', isActive: 1 },
  { storeID: '2', storeName: 'GamersGate', isActive: 1 },
  { storeID: '15', storeName: 'Fanatical', isActive: 1 },
  { storeID: '21', storeName: 'WinGameStore', isActive: 1 },
  { storeID: '23', storeName: 'GameBillet', isActive: 1 },
  { storeID: '27', storeName: 'Gamesplanet', isActive: 1 },
];

export const recordedCheapSharkRoutes: FixtureRoute[] = [
  { match: `${API}/stores`, body: recordedStores },
  // Any subset of the recorded IDs; the source reads only the ones it asked for.
  { match: /^https:\/\/www\.cheapshark\.com\/api\/1\.0\/games\?ids=(128|167910|612)(,(128|167910|612))*$/, body: recordedGames },
];
