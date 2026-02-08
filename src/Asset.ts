import mongoose, { Schema, Document } from 'mongoose';

// 1. Define Valid Locations & Departments
export type Location = 'Central Warehouse' | 'Main Building' | 'K Building' | 'N Building' | 'S Building' | 'R Building' | 'Pharmacy Building';
export type Department = 'Computer Science' | 'Engineering' | 'Architecture' | 'Business' | 'Mass Comm' | 'Alsun' | 'Pharmacy' | 'Dentistry' | 'Unassigned';

// 2. Define Valid Asset Types for the Database validation
const ASSET_TYPES = [
  // IT & Computing
  'laptop', 'desktop', 'tablet', 'server', 'monitor', 'peripheral',
  // AV & Classroom
  'projector', 'smartboard', 'camera', 'speaker', 'microphone',
  // Networking
  'router', 'switch', 'access_point', 'firewall',
  // Office & Furniture
  'printer', 'scanner', 'desk', 'chair', 'whiteboard', 'filing_cabinet',
  // Lab & Research
  'microscope', 'centrifuge', 'oscilloscope', '3d_printer', 'lab_bench',
  // Facilities
  'vehicle', 'generator', 'hvac', 'maintenance_tool'
];

// 3. The TypeScript Interface (used by server.ts)
export interface IAsset extends Document {
  customId: string;
  name: string;
  type: string; 
  status: 'active' | 'repair' | 'retired' | 'assigned' | 'maintenance';
  value: number;
  
  // ✅ NEW: Quantity Field for Bulk Inventory
  quantity: number;

  assignedUser?: string | null; 
  
  tickets: string[];

  // Supply Chain Tracking
  location: Location;
  department: Department;
  
  // Audit Trail
  history: { 
    // ✅ Added 'Distributed' and 'Received_Distribution' for bulk splitting events
    event: 'AssetAssigned' | 'AssetFaultReported' | 'Created' | 'StatusChange' | 'Transfer' | 'InfoUpdate' | 'Distributed' | 'Received_Distribution'; 
    details: string;
    date: Date;
  }[];
  
  // Mongoose automatically adds these
  createdAt: Date;
  updatedAt: Date;
}

// 4. The Mongoose Schema (Database Rules)
const assetSchema = new Schema<IAsset>({
  customId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  
  // Validate against the list defined above
  type: { 
    type: String, 
    required: true,
    enum: ASSET_TYPES 
  },
  
  status: { type: String, default: 'active' },
  value: { type: Number, default: 0 },

  // ✅ NEW: Quantity Schema Config
  quantity: { type: Number, default: 1, min: 0 },
  
  assignedUser: { type: String, default: null },
  
  tickets: [{ type: String }],

  // Location Configuration
  location: { 
    type: String, 
    required: true, 
    enum: ['Central Warehouse', 'Main Building', 'K Building', 'N Building', 'S Building', 'R Building', 'Pharmacy Building'],
    default: 'Central Warehouse' 
  },

  // Department Configuration
  department: { 
    type: String, 
    required: true,
    enum: ['Computer Science', 'Engineering', 'Architecture', 'Business', 'Mass Comm', 'Alsun', 'Pharmacy', 'Dentistry', 'Unassigned'],
    default: 'Unassigned'
  },
  
  // History Logs
  history: [{
    event: { type: String, required: true },
    details: { type: String, required: true },
    date: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

export default mongoose.model<IAsset>('Asset', assetSchema);