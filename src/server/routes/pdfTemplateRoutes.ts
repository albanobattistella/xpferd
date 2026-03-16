import { Router } from 'express';
import { PdfTemplateController } from '../controllers/PdfTemplateController.js';

const router = Router();
const ctrl = new PdfTemplateController();

/**
 * @swagger
 * /api/v1/pdf-templates:
 *   get:
 *     summary: List all PDF templates
 *     tags: [PDF Templates]
 *     responses:
 *       200:
 *         description: Array of PDF templates
 */
router.get('/', ctrl.listAll);

/**
 * @swagger
 * /api/v1/pdf-templates/{id}:
 *   get:
 *     summary: Get PDF template by ID
 *     tags: [PDF Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: PDF template
 */
router.get('/:id', ctrl.getById);

/**
 * @swagger
 * /api/v1/pdf-templates:
 *   post:
 *     summary: Create PDF template
 *     tags: [PDF Templates]
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/', ctrl.create);

/**
 * @swagger
 * /api/v1/pdf-templates/preview-draft:
 *   post:
 *     summary: Preview PDF template draft without saving
 *     tags: [PDF Templates]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [template, invoiceId]
 *             properties:
 *               template:
 *                 type: object
 *                 description: PDF template definition
 *               invoiceId:
 *                 type: integer
 *                 description: Invoice ID for preview data
 *     responses:
 *       200:
 *         description: PDF preview bytes
 *         content:
 *           application/pdf: {}
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Invoice not found
 */
// preview-draft must come BEFORE /:id routes to avoid Express treating the literal as an ID
router.post('/preview-draft', ctrl.previewDraft);

/**
 * @swagger
 * /api/v1/pdf-templates/{id}:
 *   put:
 *     summary: Update PDF template
 *     tags: [PDF Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Updated
 */
router.put('/:id', ctrl.update);

/**
 * @swagger
 * /api/v1/pdf-templates/{id}:
 *   delete:
 *     summary: Delete PDF template
 *     tags: [PDF Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204:
 *         description: Deleted
 */
router.delete('/:id', ctrl.delete);

/**
 * @swagger
 * /api/v1/pdf-templates/{id}/preview:
 *   post:
 *     summary: Generate PDF preview
 *     tags: [PDF Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: invoiceId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: PDF bytes
 *         content:
 *           application/pdf: {}
 */
router.post('/:id/preview', ctrl.preview);

/**
 * @swagger
 * /api/v1/pdf-templates/{id}/export:
 *   post:
 *     summary: Export invoice as PDF
 *     tags: [PDF Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: invoiceId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: PDF file download
 *         content:
 *           application/pdf: {}
 */
router.post('/:id/export', ctrl.exportPdf);

/**
 * @swagger
 * /api/v1/pdf-templates/{id}/export-zugferd:
 *   post:
 *     summary: Export invoice as ZUGFeRD PDF (PDF with embedded XRechnung XML)
 *     tags: [PDF Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: invoiceId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: ZUGFeRD PDF file download
 *         content:
 *           application/pdf: {}
 */
router.post('/:id/export-zugferd', ctrl.exportZugferd);

export default router;
