// Stack: TypeScript / Node 24 / Express 5 / Prisma 7 / PostgreSQL
// Tool: Claude Code (claude-opus-5-5)
// Prompt Summary: PA2 functional baseline — routes for asset CRUD, multi-field search and physical device returns (/api/v1/assets)
// AI Contribution: ~100% (generated)
// Human Modifications: none yet
// Verification: pending human review
// Confidence: pending

import { Router } from 'express';
import * as assets from '../services/assetService.js';
import {
  assetQuerySchema,
  createAssetSchema,
  returnAssetSchema,
  updateAssetSchema,
  uuidParam,
} from '../validation/schemas.js';

export const assetsRouter = Router();

const assetId = uuidParam('asset_id');

assetsRouter.post('/', async (req, res) => {
  res.status(201).json(await assets.createAsset(createAssetSchema.parse(req.body)));
});

assetsRouter.get('/', async (req, res) => {
  res.json(await assets.listAssets(assetQuerySchema.parse(req.query)));
});

assetsRouter.get('/:asset_id', async (req, res) => {
  const { asset_id } = assetId.parse(req.params);
  res.json(await assets.getAsset(asset_id));
});

assetsRouter.put('/:asset_id', async (req, res) => {
  const { asset_id } = assetId.parse(req.params);
  res.json(await assets.updateAsset(asset_id, updateAssetSchema.parse(req.body)));
});

assetsRouter.delete('/:asset_id', async (req, res) => {
  const { asset_id } = assetId.parse(req.params);
  await assets.deleteAsset(asset_id);
  res.status(204).end();
});

assetsRouter.post('/:asset_id/return', async (req, res) => {
  const { asset_id } = assetId.parse(req.params);
  res.json(await assets.returnAsset(asset_id, returnAssetSchema.parse(req.body)));
});
