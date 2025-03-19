/*
NCSA Open Source License

Copyright (c) 2024 SPT Team. All rights reserved.

Developed by: SPT Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
with the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

    Redistributions of source code must retain the above copyright notice,
    this list of conditions and the following disclaimers.

    Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimers in the documentation
    and/or other materials provided with the distribution.

    Neither the names SPT, nor the names of its contributors may be used to endorse or promote products derived from this Software without specific prior written permission.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE CONTRIBUTORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS WITH THE SOFTWARE.
*/

import fs from "node:fs";
import path from "node:path";

export class VFS
{
    public exists(filepath: string): boolean {
        return fs.existsSync(filepath);
    }

    public readFile(filepath: string): string {
        const read = fs.readFileSync(filepath);
        if (this.isTextBuffer(read)) {
            return read.toString();
        }
        return read;
    }

    private isTextBuffer(value: any): value is Buffer {
        return value?.write && value.toString && value.toJSON && value.equals;
    }

    public writeFile(filepath: string, data = "", append = false): void {
        const options = append ? { flag: "a" } : { flag: "w" };

        if (!this.exists(filepath)) {
            this.createDir(filepath);
            fs.writeFileSync(filepath, "");
        }

        fs.writeFileSync(filepath, data, options);
    }

    public createDir(filepath: string): void {
        fs.mkdirSync(path.dirname(filepath), { recursive: true });
    }

    public getFiles(filepath: string): string[] {
        return fs.readdirSync(filepath).filter((item) => {
            return fs.statSync(path.join(filepath, item)).isFile();
        });
    }

    public getDirs(filepath: string): string[] {
        return fs.readdirSync(filepath).filter((item) => {
            return fs.statSync(path.join(filepath, item)).isDirectory();
        });
    }

    public stripExtension(filepath: string): string {
        return filepath.split(".").slice(0, -1).join(".");
    }

    public resolve(filepath: string) {
        return path.resolve(__dirname, filepath);   
    }
    
    
    public copyDir(filepath: string, target: string, fileExtensions?: string | string[]): void {
        const files = this.getFiles(filepath);
        const dirs = this.getDirs(filepath);

        if (!this.exists(target)) {
            this.createDir(`${target}/`);
        }

        for (const dir of dirs) {
            this.copyDir(path.join(filepath, dir), path.join(target, dir), fileExtensions);
        }

        for (const file of files) {
            // copy all if fileExtension is not set, copy only those with fileExtension if set
            if (!fileExtensions || fileExtensions.includes(file.split(".").pop() ?? "")) {
                this.copyFile(path.join(filepath, file), path.join(target, file));
            }
        }
    }
    public copyFile(filepath: fs.PathLike, target: fs.PathLike): void {
        fs.copyFileSync(filepath, target);
    }
}