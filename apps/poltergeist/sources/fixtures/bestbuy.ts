import type { FixtureRoute } from '@crypt-kit/core/testing';

/**
 * Best Buy Products API responses shaped on its documentation (bestbuyapis.github.io,
 * read 2026-11-19): `show` fields only, link form `https://api.bestbuy.com/click/-/<sku>/pdp`.
 * Not recorded live, since recording needs an API key; replace with recordings once one exists.
 */
export const BESTBUY_API = 'https://api.bestbuy.com/v1';
export const TEST_KEY = 'test-key-not-real';

export const products = {
  camera: {
    sku: 6323759,
    name: 'Canon - EOS Rebel T7 DSLR Video Two Lens Kit with EF-S 18-55mm and EF 75-300mm Lenses',
    salePrice: 449.99,
    regularPrice: 549.99,
    url: 'https://api.bestbuy.com/click/-/6323759/pdp',
    type: 'HardGood',
  },
  tvStick: { sku: 5477500, name: 'Amazon - Fire TV Stick with Alexa Voice Remote - Black', salePrice: 39.99, regularPrice: 39.99, url: 'https://api.bestbuy.com/click/-/5477500/pdp', type: 'HardGood' },
  movie: { sku: 1000001, name: 'A Movie [Blu-ray]', salePrice: 9.99, regularPrice: 19.99, url: 'https://api.bestbuy.com/click/-/1000001/pdp', type: 'Movie' },
};

const page = (items: object[]) => ({ from: 1, to: items.length, total: items.length, currentPage: 1, totalPages: 1, partial: false, products: items });

const SHOW = 'format=json&show=sku,name,salePrice,regularPrice,url,type';
export const recordedBestBuyRoutes: FixtureRoute[] = [
  {
    match: `${BESTBUY_API}/products(sku%20in(1000001,5477500,6323759))?${SHOW}&pageSize=100&apiKey=${TEST_KEY}`,
    body: page([products.camera, products.tvStick, products.movie]),
  },
  {
    match: `${BESTBUY_API}/products(sku%20in(5477500,6323759))?${SHOW}&pageSize=100&apiKey=${TEST_KEY}`,
    body: page([products.camera, products.tvStick]),
  },
  {
    match: `${BESTBUY_API}/products(search=canon&search=rebel)?${SHOW}&pageSize=10&apiKey=${TEST_KEY}`,
    body: page([products.camera, products.movie]),
  },
];
