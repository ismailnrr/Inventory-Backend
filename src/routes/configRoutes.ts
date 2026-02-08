import express from 'express';
import { BUILDINGS, DEPARTMENTS, ASSET_TYPES } from '../config/constants';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    buildings: BUILDINGS,
    departments: DEPARTMENTS,
    assetTypes: ASSET_TYPES
  });
});

export default router;