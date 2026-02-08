import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import Asset from './Asset';
import { EventBus } from './services/EventBus';
import { TOPICS } from './events/assetEvents';
import { BUILDINGS, DEPARTMENTS, ASSET_TYPES } from './config/constants';
import ticketRoutes from './routes/ticketRoutes'; 
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// --- 1. ROBUST SWAGGER DEFINITION (JSON Format) ---
// We use a JS object here instead of comments to avoid indentation errors.
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'OpsMind Inventory API',
    version: '1.0.0',
    description: 'API for managing IT assets',
  },
  servers: [
    { url: 'http://localhost:5000', description: 'Local Server' },
  ],
  components: {
    schemas: {
      Asset: {
        type: 'object',
        required: ['name', 'type', 'customId'],
        properties: {
          customId: { type: 'string', description: 'Unique Asset ID' },
          name: { type: 'string', description: 'Asset Name' },
          type: { type: 'string', description: 'Category (Laptop, etc.)' },
          location: { type: 'string' },
          department: { type: 'string' },
          quantity: { type: 'number' },
          status: { type: 'string' }
        },
        example: {
          customId: 'LAP-001',
          name: 'MacBook Pro',
          type: 'Laptop',
          location: 'HQ',
          department: 'Engineering',
          quantity: 5,
          status: 'active'
        }
      }
    }
  },
  paths: {
    '/api/assets': {
      get: {
        summary: 'Get all assets',
        tags: ['Assets'],
        responses: {
          200: {
            description: 'List of assets',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Asset' } } } }
          }
        }
      },
      post: {
        summary: 'Create a new asset',
        tags: ['Assets'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } }
        },
        responses: {
          200: { description: 'Asset created' }
        }
      }
    },
    '/api/assets/{id}': {
      delete: {
        summary: 'Delete an asset',
        tags: ['Assets'],
        parameters: [
          { in: 'path', name: 'id', schema: { type: 'string' }, required: true, description: 'Asset ID' }
        ],
        responses: {
          200: { description: 'Asset deleted' },
          404: { description: 'Not found' }
        }
      }
    },
    '/api/assets/{id}/transfer': {
      patch: {
        summary: 'Transfer asset to new location/owner',
        tags: ['Assets'],
        parameters: [
          { in: 'path', name: 'id', schema: { type: 'string' }, required: true }
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  destType: { type: 'string', enum: ['building', 'department', 'user'] },
                  destination: { type: 'string' },
                  quantityToMove: { type: 'number' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Transfer successful' }
        }
      }
    }
  }
};

const swaggerOptions = {
  definition: swaggerDefinition,
  apis: [], // We are not using comments anymore!
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// --- 2. DATABASE CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/opsmind_assets';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ [API] Connected to MongoDB'))
  .catch((err: any) => console.error('❌ [API] DB Connection Error:', err));

// --- 3. ROUTES ---

app.use('/api/tickets', ticketRoutes);

app.get('/api/config', (req: Request, res: Response) => {
  res.json({ buildings: BUILDINGS, departments: DEPARTMENTS, assetTypes: ASSET_TYPES });
});

app.get('/api/assets', async (req: Request, res: Response) => {
  try {
    const assets = await Asset.find().sort({ createdAt: -1 });
    res.json(assets);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch assets' }); }
});

app.post('/api/assets', async (req: Request, res: Response) => {
  try {
    const { name, type, value, customId, location, department, quantity } = req.body;
    
    const newAsset = await Asset.create({
      customId, name, type, value,
      location: location || 'Central Warehouse',
      department: department || 'Unassigned',
      quantity: quantity || 1,
      history: []
    });

    await EventBus.publish(TOPICS.ASSET_CREATED, {
      customId: newAsset.customId,
      location: newAsset.location,
      quantity: newAsset.quantity,
      timestamp: new Date()
    });

    res.json(newAsset);
  } catch (error: any) {
    if (error.code === 11000) return res.status(400).json({ message: "Asset ID already exists" });
    res.status(500).json({ message: error.message });
  }
});

// Transfer Route
app.patch('/api/assets/:id/transfer', async (req: Request, res: Response) => {
  const { destType, destination, quantityToMove } = req.body; 

  try {
    const asset = await Asset.findOne({ customId: req.params.id });
    if (!asset) return res.status(404).json({ message: "Asset not found" });

    let updateData: any = {};
    
    if (destType === 'building') {
        updateData.location = destination;
        updateData.status = 'active'; 
        updateData.assignedUser = null; 
    } else if (destType === 'department') {
        updateData.department = destination;
    } else if (destType === 'user') {
        updateData.assignedUser = destination;
        updateData.status = 'assigned';
    }

    const moveQty = Number(quantityToMove) || asset.quantity;
    
    if (moveQty > asset.quantity) return res.status(400).json({ message: "Not enough quantity." });

    if (moveQty === asset.quantity) {
      Object.assign(asset, updateData); 
      await asset.save();
      
      await EventBus.publish(TOPICS.ASSET_TRANSFERRED, {
        customId: asset.customId,
        destinationType: destType,
        destination: destination,
        quantity: moveQty,
        type: 'FULL_TRANSFER'
      });
      return res.json(asset);
    }

    asset.quantity -= moveQty;
    await asset.save();

    const newSplitId = `${asset.customId}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newBatch = await Asset.create({
      customId: newSplitId,
      name: asset.name,
      type: asset.type,
      value: asset.value,
      quantity: moveQty,
      history: [],
      ...updateData,
      location: updateData.location || asset.location,
      department: updateData.department || asset.department,
      status: updateData.status || asset.status
    });

    await EventBus.publish(TOPICS.ASSET_TRANSFERRED, {
      originalId: asset.customId,
      customId: newSplitId,
      destinationType: destType,
      destination: destination,
      quantity: moveQty,
      type: 'SPLIT_DISTRIBUTION'
    });

    res.json({ original: asset, newBatch });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Transfer failed" });
  }
});

app.delete('/api/assets/:id', async (req: Request, res: Response) => {
  try {
    const deletedAsset = await Asset.findByIdAndDelete(req.params.id);
    if (!deletedAsset) return res.status(404).json({ message: 'Asset not found' });
    
    await EventBus.publish(TOPICS.ASSET_DELETED, { customId: deletedAsset.customId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.patch('/api/assets/:id/status', async (req: Request, res: Response) => {
    const { status } = req.body;
    await Asset.findOneAndUpdate({ customId: req.params.id }, { status });
    res.json({ success: true });
});

app.patch('/api/assets/:id/details', async (req: Request, res: Response) => {
  const { name, type, department, quantity } = req.body;
  await Asset.findOneAndUpdate({ customId: req.params.id }, { name, type, department, quantity });
  res.json({ success: true });
});

const startServer = async () => {
  await EventBus.connect();
  app.listen(PORT, () => {
    console.log(`🚀 API Service running on http://localhost:${PORT}`);
    console.log(`📄 Swagger UI available at http://localhost:${PORT}/api-docs`);
    console.log(`🐰 RabbitMQ Producer Connected`);
  });
};

startServer();

process.on('SIGINT', async () => {
  console.log('\n🛑 API shutting down...');
  await mongoose.connection.close();
  process.exit(0);
});