import { Router } from 'express';
import { InvoiceNumberTemplateController } from '../controllers/InvoiceNumberTemplateController.js';
import { PaymentTemplateController } from '../controllers/PaymentTemplateController.js';
import { LineItemTemplateController } from '../controllers/LineItemTemplateController.js';
import { InvoiceTemplateController } from '../controllers/InvoiceTemplateController.js';

const router = Router();

// Invoice Number Templates
const invNumCtrl = new InvoiceNumberTemplateController();

/**
 * @swagger
 * /api/v1/templates/invoice-numbers:
 *   get:
 *     summary: List all invoice number templates
 *     tags: [Templates]
 *     responses:
 *       200:
 *         description: Array of templates
 */
router.get('/invoice-numbers', invNumCtrl.listAll);

/**
 * @swagger
 * /api/v1/templates/invoice-numbers/{id}/preview:
 *   get:
 *     summary: Preview next invoice number without incrementing
 *     tags: [Invoice Number Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Preview of next invoice number
 *       404:
 *         description: Template not found
 */
router.get('/invoice-numbers/:id/preview', invNumCtrl.previewNext);

/**
 * @swagger
 * /api/v1/templates/invoice-numbers/{id}:
 *   get:
 *     summary: Get invoice number template by ID
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Invoice number template
 *       404:
 *         description: Not found
 */
router.get('/invoice-numbers/:id', invNumCtrl.getById);

/**
 * @swagger
 * /api/v1/templates/invoice-numbers:
 *   post:
 *     summary: Create invoice number template
 *     tags: [Templates]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, prefix, digits, nextNumber]
 *             properties:
 *               name:
 *                 type: string
 *               prefix:
 *                 type: string
 *               digits:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 6
 *               nextNumber:
 *                 type: integer
 *                 minimum: 1
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/invoice-numbers', invNumCtrl.create);

/**
 * @swagger
 * /api/v1/templates/invoice-numbers/{id}:
 *   put:
 *     summary: Update invoice number template
 *     tags: [Templates]
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
 *             type: object
 *             required: [name, prefix, digits, nextNumber]
 *             properties:
 *               name:
 *                 type: string
 *               prefix:
 *                 type: string
 *               digits:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 6
 *               nextNumber:
 *                 type: integer
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Updated
 */
router.put('/invoice-numbers/:id', invNumCtrl.update);

/**
 * @swagger
 * /api/v1/templates/invoice-numbers/{id}/generate:
 *   post:
 *     summary: Generate next invoice number
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Generated invoice number
 */
router.post('/invoice-numbers/:id/generate', invNumCtrl.generateNext);

/**
 * @swagger
 * /api/v1/templates/invoice-numbers/{id}:
 *   delete:
 *     summary: Delete invoice number template
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204:
 *         description: Deleted
 */
router.delete('/invoice-numbers/:id', invNumCtrl.delete);

// Payment Templates
const payCtrl = new PaymentTemplateController();

/**
 * @swagger
 * /api/v1/templates/payments:
 *   get:
 *     summary: List all payment templates
 *     tags: [Templates]
 *     responses:
 *       200:
 *         description: Array of templates
 */
router.get('/payments', payCtrl.listAll);

/**
 * @swagger
 * /api/v1/templates/payments/{id}:
 *   get:
 *     summary: Get payment template by ID
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Payment template
 *       404:
 *         description: Not found
 */
router.get('/payments/:id', payCtrl.getById);

/**
 * @swagger
 * /api/v1/templates/payments:
 *   post:
 *     summary: Create payment template
 *     tags: [Templates]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, paymentMeansCode]
 *             properties:
 *               name:
 *                 type: string
 *               paymentMeansCode:
 *                 type: string
 *               iban:
 *                 type: string
 *               bic:
 *                 type: string
 *               paymentTerms:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/payments', payCtrl.create);

/**
 * @swagger
 * /api/v1/templates/payments/{id}:
 *   put:
 *     summary: Update payment template
 *     tags: [Templates]
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
 *             type: object
 *             required: [name, paymentMeansCode]
 *             properties:
 *               name:
 *                 type: string
 *               paymentMeansCode:
 *                 type: string
 *               iban:
 *                 type: string
 *               bic:
 *                 type: string
 *               paymentTerms:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated
 */
router.put('/payments/:id', payCtrl.update);

/**
 * @swagger
 * /api/v1/templates/payments/{id}:
 *   delete:
 *     summary: Delete payment template
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204:
 *         description: Deleted
 */
router.delete('/payments/:id', payCtrl.delete);

// Line Item Templates
const lineCtrl = new LineItemTemplateController();

/**
 * @swagger
 * /api/v1/templates/line-items:
 *   get:
 *     summary: List all line item templates
 *     tags: [Templates]
 *     responses:
 *       200:
 *         description: Array of templates
 */
router.get('/line-items', lineCtrl.listAll);

/**
 * @swagger
 * /api/v1/templates/line-items/{id}:
 *   get:
 *     summary: Get line item template by ID
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Line item template
 *       404:
 *         description: Not found
 */
router.get('/line-items/:id', lineCtrl.getById);

/**
 * @swagger
 * /api/v1/templates/line-items:
 *   post:
 *     summary: Create line item template
 *     tags: [Templates]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, unitCode, netPrice, vatCategoryCode, vatRate]
 *             properties:
 *               name:
 *                 type: string
 *               unitCode:
 *                 type: string
 *               netPrice:
 *                 type: number
 *                 minimum: 0
 *               vatCategoryCode:
 *                 type: string
 *               vatRate:
 *                 type: number
 *                 minimum: 0
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/line-items', lineCtrl.create);

/**
 * @swagger
 * /api/v1/templates/line-items/{id}:
 *   put:
 *     summary: Update line item template
 *     tags: [Templates]
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
 *             type: object
 *             required: [name, unitCode, netPrice, vatCategoryCode, vatRate]
 *             properties:
 *               name:
 *                 type: string
 *               unitCode:
 *                 type: string
 *               netPrice:
 *                 type: number
 *                 minimum: 0
 *               vatCategoryCode:
 *                 type: string
 *               vatRate:
 *                 type: number
 *                 minimum: 0
 *     responses:
 *       200:
 *         description: Updated
 */
router.put('/line-items/:id', lineCtrl.update);

/**
 * @swagger
 * /api/v1/templates/line-items/{id}:
 *   delete:
 *     summary: Delete line item template
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204:
 *         description: Deleted
 */
router.delete('/line-items/:id', lineCtrl.delete);

// Invoice Templates
const invTplCtrl = new InvoiceTemplateController();

/**
 * @swagger
 * /api/v1/templates/invoice-templates:
 *   get:
 *     summary: List all invoice templates
 *     tags: [Templates]
 *     responses:
 *       200:
 *         description: Array of invoice templates
 */
router.get('/invoice-templates', invTplCtrl.listAll);

/**
 * @swagger
 * /api/v1/templates/invoice-templates/{id}:
 *   get:
 *     summary: Get invoice template by ID
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Invoice template
 */
router.get('/invoice-templates/:id', invTplCtrl.getById);

/**
 * @swagger
 * /api/v1/templates/invoice-templates:
 *   post:
 *     summary: Create invoice template
 *     tags: [Templates]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, data]
 *             properties:
 *               name:
 *                 type: string
 *               data:
 *                 type: string
 *                 description: Serialized invoice template data (JSON string)
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/invoice-templates', invTplCtrl.create);

/**
 * @swagger
 * /api/v1/templates/invoice-templates/{id}:
 *   put:
 *     summary: Update invoice template
 *     tags: [Templates]
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
 *             type: object
 *             required: [name, data]
 *             properties:
 *               name:
 *                 type: string
 *               data:
 *                 type: string
 *                 description: Serialized invoice template data (JSON string)
 *     responses:
 *       200:
 *         description: Updated
 */
router.put('/invoice-templates/:id', invTplCtrl.update);

/**
 * @swagger
 * /api/v1/templates/invoice-templates/{id}:
 *   delete:
 *     summary: Delete invoice template
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204:
 *         description: Deleted
 */
router.delete('/invoice-templates/:id', invTplCtrl.delete);

export default router;
