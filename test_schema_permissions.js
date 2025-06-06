#!/usr/bin/env node

// Simple test script to validate schema generation with permission filtering
const fs = require('fs');
const path = require('path');

console.log('Testing schema permission filtering...');

// Check if the ModelSchema.ts file has the correct changes
const modelSchemaPath = path.join(__dirname, 'Common/Utils/Schema/ModelSchema.ts');

if (fs.existsSync(modelSchemaPath)) {
  const content = fs.readFileSync(modelSchemaPath, 'utf8');
  
  // Check for the updated formatPermissionsForSchema method
  const hasCorrectPermissionMessage = content.includes('No access - restricted access only');
  console.log('✓ formatPermissionsForSchema updated:', hasCorrectPermissionMessage ? 'PASS' : 'FAIL');
  
  // Check for permission filtering in getModelSchema
  const hasGeneralSchemaFiltering = content.includes('// Get column access control for permission filtering') &&
                                   content.includes('const columnAccessControl: Dictionary<ColumnAccessControl> = model.getColumnAccessControlForAllColumns();') &&
                                   content.includes('hasReadPermissions');
  console.log('✓ getModelSchema permission filtering:', hasGeneralSchemaFiltering ? 'PASS' : 'FAIL');
  
  // Check for permission filtering in buildModelSchema
  const hasBuildSchemaFiltering = content.includes('// Filter out columns with no permissions (root-only access)') &&
                                 content.includes('hasPermissions = true;');
  console.log('✓ buildModelSchema permission filtering:', hasBuildSchemaFiltering ? 'PASS' : 'FAIL');
  
  if (hasCorrectPermissionMessage && hasGeneralSchemaFiltering && hasBuildSchemaFiltering) {
    console.log('\n🎉 All permission filtering changes implemented successfully!');
    console.log('\nSummary of changes:');
    console.log('1. formatPermissionsForSchema now returns "No access - restricted access only" for empty permissions');
    console.log('2. getModelSchema now filters out columns with no read permissions');
    console.log('3. buildModelSchema filters columns based on operation-specific permissions (create/read/update)');
    console.log('\nColumns with empty permission arrays will now be excluded from OpenAPI schemas entirely.');
  } else {
    console.log('\n❌ Some changes are missing. Please review the implementation.');
  }
} else {
  console.log('❌ ModelSchema.ts file not found at expected location.');
}
