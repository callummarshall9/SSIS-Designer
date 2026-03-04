import * as vscode from 'vscode';
import { SsisPackageModel } from '../models/SsisPackageModel';
import { DtsxSerializer } from '../canvas/shared/DtsxSerializer';

/**
 * Service for reading and writing DTSX (SSIS package) files.
 * Uses {@link DtsxSerializer} for XML ↔ model conversion.
 */
export class DtsxFileService {
    private readonly serializer = new DtsxSerializer();

    /**
     * Read and parse a .dtsx file into an {@link SsisPackageModel}.
     */
    async readPackage(uri: vscode.Uri): Promise<SsisPackageModel> {
        const content = await vscode.workspace.fs.readFile(uri);
        const rawXml = new TextDecoder().decode(content);
        return this.serializer.parse(rawXml);
    }

    /**
     * Serialize an {@link SsisPackageModel} back to XML and write to file.
     *
     * @param uri          Target file URI.
     * @param model        The package model to write.
     * @param originalXml  If provided, the serializer operates in "merge" mode
     *   to preserve unknown elements and formatting from the original XML.
     */
    async writePackage(
        uri: vscode.Uri,
        model: SsisPackageModel,
        originalXml?: string,
    ): Promise<void> {
        const xml = this.serializer.serialize(model, originalXml);
        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(uri, encoder.encode(xml));
    }

    /**
     * Read the raw XML string from a .dtsx file.
     */
    async readRawXml(uri: vscode.Uri): Promise<string> {
        const content = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder().decode(content);
    }
}
