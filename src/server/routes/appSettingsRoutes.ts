import { Router } from 'express';
import { AppSettingsController } from '../controllers/AppSettingsController.js';

const router = Router();
const controller = new AppSettingsController();

/**
 * @swagger
 * components:
 *   schemas:
 *     AppSettings:
 *       type: object
 *       required: [locale, dateFormat, numberFormat]
 *       properties:
 *         locale: { type: string, enum: [de-DE], example: 'de-DE' }
 *         dateFormat: { type: string, enum: ['DD.MM.YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD-MM-YYYY'], example: 'DD.MM.YYYY' }
 *         numberFormat: { type: string, enum: ['de-DE', 'en-US'], example: 'de-DE' }
 */

/**
 * @swagger
 * /api/v1/settings:
 *   get:
 *     summary: Get app settings
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Current settings
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppSettings'
 */
router.get('/', controller.get);

/**
 * @swagger
 * /api/v1/settings:
 *   put:
 *     summary: Update app settings
 *     tags: [Settings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AppSettings'
 *     responses:
 *       200:
 *         description: Updated settings
 *       400:
 *         description: Validation error
 */
router.put('/', controller.update);

export default router;
