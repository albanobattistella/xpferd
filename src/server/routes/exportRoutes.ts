import { Router } from 'express';
import { ExportController } from '../controllers/ExportController.js';

const router = Router();
const controller = new ExportController();

/**
 * @swagger
 * /api/v1/invoices/{id}/export:
 *   get:
 *     summary: Export invoice as XRechnung XML
 *     tags: [Export]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: XRechnung XML file
 *         content:
 *           application/xml:
 *             schema:
 *               type: string
 *       404:
 *         description: Not found
 */
router.get('/:id/export', controller.exportXml);

export default router;
