import { Router } from 'express';
import { PartyController } from '../controllers/PartyController.js';

const router = Router();
const controller = new PartyController();

/**
 * @swagger
 * components:
 *   schemas:
 *     Party:
 *       type: object
 *       required: [type, name, street, city, postalCode, countryCode]
 *       properties:
 *         id: { type: integer, readOnly: true }
 *         type: { type: string, enum: [seller, buyer] }
 *         name: { type: string }
 *         street: { type: string }
 *         city: { type: string }
 *         postalCode: { type: string }
 *         countryCode: { type: string }
 *         vatId: { type: string }
 *         taxNumber: { type: string }
 *         contactName: { type: string }
 *         contactPhone: { type: string }
 *         contactEmail: { type: string }
 *         email: { type: string }
 */

/**
 * @swagger
 * /api/v1/parties:
 *   get:
 *     summary: List all parties
 *     tags: [Parties]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [seller, buyer] }
 *         description: Filter by party type
 *     responses:
 *       200:
 *         description: Array of parties
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Party'
 */
router.get('/', controller.listAll);

/**
 * @swagger
 * /api/v1/parties:
 *   post:
 *     summary: Create a new party
 *     tags: [Parties]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Party'
 *     responses:
 *       201:
 *         description: Created party
 *       400:
 *         description: Validation error
 */
router.post('/', controller.create);

/**
 * @swagger
 * /api/v1/parties/{id}:
 *   get:
 *     summary: Get party by ID
 *     tags: [Parties]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Party details
 *       404:
 *         description: Not found
 */
router.get('/:id', controller.getById);

/**
 * @swagger
 * /api/v1/parties/{id}:
 *   put:
 *     summary: Update a party
 *     tags: [Parties]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Party'
 *     responses:
 *       200:
 *         description: Updated party
 *       404:
 *         description: Not found
 */
router.put('/:id', controller.update);

/**
 * @swagger
 * /api/v1/parties/{id}:
 *   delete:
 *     summary: Delete a party
 *     tags: [Parties]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
router.delete('/:id', controller.delete);

export default router;
