'use strict';

const { z } = require('zod');
const { Direction, VehicleType } = require('../domain/models');

const manualRequestSchema = z.object({
  adminId: z.string().min(1),
  direction: z.nativeEnum(Direction)
});

const automaticRequestSchema = z.object({
  adminId: z.string().min(1)
});

const sensorEventSchema = z.object({
  eventId: z.string().min(1),
  direction: z.nativeEnum(Direction),
  vehicleId: z.string().min(1),
  vehicleType: z.nativeEnum(VehicleType).optional(),
  type: z.enum(['VEHICLE_ARRIVED', 'VEHICLE_CLEARED']),
  sequenceNo: z.number().int().min(1),
  timestamp: z.number().int().positive()
});

function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  manualRequestSchema,
  automaticRequestSchema,
  sensorEventSchema,
  validateBody
};
