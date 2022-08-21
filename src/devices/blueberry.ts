import { WebglLinePlotProps } from "webgl-plot-utils";

export function blueberrycodec(value:DataView) {

    let output = {
        LED1: value.getInt32(2),
        LED2: value.getInt32(6),
        LED3: value.getInt32(10)
    }

    return output;
}


export const blueberryBLESettings = {
    services:{
        '0f0e0d0c-0b0a-0908-0706-050403020100':{
            '1f1e1d1c-1b1a-1918-1716-151413121110':{
                write:undefined //new Uint8Array([0xA0],[redValue], [greenValue], [blueValue]); //for rgb controller
            },
            '3f3e3d3c-3b3a-3938-3736-353433323130':{
                notify:true,
                notifyCallback:undefined,
                codec:blueberrycodec
            }
        }
    }
}


export const blueberryChartSettings:Partial<WebglLinePlotProps> = {
    lines:{
        LED1:{nSec:60, sps:40},
        LED2:{nSec:60, sps:40},
        LED3:{nSec:60, sps:40}
    }
}