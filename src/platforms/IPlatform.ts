import { IToken } from 'dequanto/models/IToken';
import { TEth } from 'dequanto/models/TEth';

export interface IPlatform {
    Tokens: Record<string, Partial<IToken>>;

    Tranches: {
        [id: string]: {
            base: Partial<IToken>,

            jrt: {
                name: string
                description: string
            },
            srt: {
                name: string
                description: string
            }
        }
    }
}
