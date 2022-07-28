import {StreamInfo, WebSerial} from './src/serial/serialstream'
import {BLEClient} from './src/ble/ble_client'
import {Router, DOMService, WorkerService, gsworker, ServiceMessage, proxyWorkerRoutes, workerCanvasRoutes, DOMElement} from '../GraphServiceRouter/index' //'graphscript'
import { ElementInfo, ElementProps } from 'graphscript/dist/services/dom/types/element';
import { DOMElementProps } from 'graphscript/dist/services/dom/types/component';

/**
    <Debugger window component>
        <------------------------------------------>
            <BLE Button>
            <BLE Config>
                <device filters> - i.e. the namePrefix 

                When paired:
                <Toggle services> - each one toggled on should get its own console output 
                                and visual container like nrf connect, but in the console

            Browser only:
            <Serial Button>
            <Serial Config>
                <device filters>
                <baudRate>
                <bufferSize>

            Show several active connections in their own sub windows with selective disconnecting and decoding etc.

            Console mode (toggle one):
            <Latest> (only the most recent samples in raw text)
            <Scrolling> (up to 1000 samples in raw text)
            <Charting> (if debugger output matches a given format - use arduino output format?)
            <Blocks> (for ble services)

            Create a window for active serial connections with selective disconnecting and decoding etc.
        <------------------------------------------>
            <Console window> - takes up most of the screen
            Create a console for each active usb connection/ble characteristic (read/write/notify)
        <------------------------------------------>
            <Connection Info> - expands
            <Decoder options> - expands (default text and raw byte outputs, plus write-your-own with a simple callback to return modified results, incl a set format that can be charted arbitrarily)
            <Line break format> - dropdown and custom input (e.g. look for \r\n end stop bytes)

*/

const Serial = new WebSerial();
const BLE = new BLEClient();


const workers = new WorkerService(); 
const decoderworker = workers.addWorker({url:gsworker}); //this will handle decoder logic
const chartworker = workers.addWorker({url:gsworker}); //this will visualize data for us if formats fit

decoderworker.request( 
    {
        route:'setRoute', 
        args:[
            function (value:any) { //to be overwritten when we want to swap decoders
                return value; //ping pong
            }.toString(),
            'decode'
        ]
    } as ServiceMessage //use service messages to communicate with disconnected service graphs
).then(console.log);

//let's load the serial library in a worker and try to run it there >_>
decoderworker.request(
    {
        route:'receiveClass',
        args:[WebSerial.toString(),'WebSerial'] 
    } as ServiceMessage
).then(console.log);

//create a callback to setup our transferred class
decoderworker.request(
    {
        route:'setRoute',
        args:[
            function setupSerial(self) {
                self.graph.Serial = new self.graph.WebSerial() as WebSerial; 
                console.log('setting up Serial', self.graph.Serial)

                self.graph.Serial.getPorts().then(console.log)
                return true;
            }.toString(),
            'setupSerial'
        ]
    } as ServiceMessage
).then(console.log);

decoderworker.request({route:'setupSerial'}).then(console.log); //now make sure it is ready


let textdecoder = new TextDecoder();

const decoders = {
    'raw':(data:ArrayBuffer) => { return data; },
    'utf8':(data:ArrayBuffer) => { return textdecoder.decode(data); },
    'console-f12':(data:ArrayBuffer) => { console.log(data); }
    //ads131m08
    //max3010x
    //mpu6050
    //freeeg32
    //openbcicyton
    //cognixionBLE
    //hegduino -- incl check for android (3 outputs only) output
    //...custom?
}

//alternatively, implement this all in a single web component
const domtree = {
    'debugger': {
        template:()=>{return '';},//`<div>Test</div>`;}, //`<div>Test</div>`
        tagName:'device-debugger',
        styles:`
        div {
            background-color: gray;
        }
        `,
        children:{
            'header':{
                tagName:'div',
                children:{
                    'bleconnect':{
                        tagName:'button',
                        innerText:'BLE Device',
                        oncreate:(self: HTMLElement, info?: ElementInfo)=>{
                            self.onclick = () => {

                                let services:any = {}; //comma separated
                                (document.getElementById('serviceuuid') as HTMLInputElement).value.split(',').forEach((uu) => { services[uu] = {}; }); //todo, set up characteristics on first go
                                if(Object.keys(services).length === 0) services = {['0000CAFE-B0BA-8BAD-F00D-DEADBEEF0000'.toLowerCase()]:{}};

                                BLE.setup({
                                    services
                                }).then((stream)=>{
                                    console.log(stream)

                                    class ConnectionTemplate extends DOMElement {
                                            
                                        stream=stream;
                                        output:any;

                                        constructor() {
                                            super(); 
                                        };

                                        anim:any;

                                        template = ()=>{ return `
                                            <div id='${this.stream.deviceId}' style='display:none;'>
                                                BLE Connection
                                                <div>
                                                    <span>BLE Device Name:</span><span>${this.stream.device.name}</span><span>BLE Device ID:</span><span>${this.stream.deviceId}</span>
                                                </div>
                                                <table id='${this.stream.deviceId}info'>
                                                </table>
                                                <div>
                                                    <button id='${this.stream.deviceId}xconnect'>Disconnect</button>
                                                    <button id='${this.stream.deviceId}x'>Remove</button>
                                                </div>
                                                <div>
                                                    <label>
                                                        Decoder:
                                                        <select id='${this.stream.deviceId}decoder'>
                                                            ${Object.keys(decoders).map((d) => `<option value='${d}'>${d.toUpperCase()}</option>`).join('')}
                                                        </select>
                                                    </label>
                                                    <label>
                                                        Output Mode: <br/>
                                                        <select id='${this.stream.deviceId}outputmode'>
                                                            <option value='b' selected> All </option>
                                                            <option value='a'> Latest </option>
                                                        </select>
                                                    </label>
                                                </div>
                                                <div id='${this.stream.deviceId}console' style='color:white; background-color:black; font-size:10px; font-family:Consolas,monaco,monospace; overflow-y:scroll;'>
                                                </div>
                                            </div>`;
                                        }

                                        oncreate = (self:DOMElement,props:any) => {
                                            BLE.client.getServices(this.stream.device.deviceId).then((svcs) => {
                                                console.log('services', svcs)
                                                document.getElementById(this.stream.deviceId+'info').innerHTML = `<tr><th>UUID</th><th>Notify</th><th>Read</th><th>Write</th><th>Broadcast</th><th>Indicate</th></tr>`
                                                svcs.forEach((s) => {    
                                                    document.getElementById(this.stream.deviceId+'info').insertAdjacentHTML('beforeend', `<tr colSpan=6><th>${s.uuid}</th></tr>`)
                                                    s.characteristics.forEach((c) => { 
                                                        //build interactivity/subscriptions for each available service characteristic based on readable/writable/notify properties
                                                        document.getElementById(this.stream.deviceId+'info').insertAdjacentHTML(
                                                            'beforeend', 
                                                            `<tr>
                                                                <td id='${c.uuid}'>${c.uuid}</td>
                                                                <td id='${c.uuid}notify'>${c.properties.notify ? `<button id="${c.uuid}notifybutton"></button> Decoder: <select id="${c.uuid}notifyselect">${Object.keys(decoders).map((d,i) => `<option value='${d}' ${i === 0 ? 'selected' : ''}>${d.toUpperCase()}</option>`).join('')}</select>` : ''}</td>
                                                                <td id='${c.uuid}read'>${c.properties.read ? `<button id="${c.uuid}readbutton"></button> Decoder: <select id="${c.uuid}readselect">${Object.keys(decoders).map((d,i) => `<option value='${d}' ${i === 0 ? 'selected' : ''}>${d.toUpperCase()}</option>`).join('')}</select>` : ''}</td>
                                                                <td id='${c.uuid}write'>${c.properties.write ? `<input type='text' id="${c.uuid}writeinput"></input><button id="${c.uuid}writebutton"></button>` : ''}</td>
                                                                <td id='${c.uuid}broadcast'>${c.properties.broadcast}</td>
                                                                <td id='${c.uuid}indicate'>${c.properties.indicate}</td>
                                                            </tr>`
                                                        );

                                                        if(c.properties.notify) {
                                                            document.getElementById(c.uuid+'notifybutton').onclick = () => {
                                                                let decoderselect = document.getElementById(c.uuid+'notifyselect') as HTMLInputElement;
                                                                BLE.subscribe(this.stream.device, s.uuid, c.uuid, (result:DataView) => {
                                                                    this.output = decoders[decoderselect.value](result.buffer);

                                                                    //requestAnimationFrame(this.anim);
                                                                    this.anim();
                                                                })
                                                            }
                                                        }
                                                        if(c.properties.read) {
                                                            let decoderselect = document.getElementById(c.uuid+'readselect') as HTMLInputElement;
                                                            document.getElementById(c.uuid+'readbutton').onclick = () => { 
                                                                BLE.read(this.stream.device, s.uuid, c.uuid, (result:DataView) => {
                                                                    this.output = decoders[decoderselect.value](result.buffer);

                                                                    //requestAnimationFrame(this.anim);
                                                                    this.anim();
                                                                })
                                                            }
                                                        }
                                                        if(c.properties.write) {
                                                            let writeinput = document.getElementById(c.uuid+'writeinput') as HTMLInputElement;
                                                            document.getElementById(c.uuid+'writebutton').onclick = () => { 
                                                                let value:any = writeinput.value;
                                                                if(parseInt(value)) value = parseInt(value);
                                                                BLE.write(this.stream.device, s.uuid, c.uuid, BLEClient.toDataView(value), () => {
                                                                    this.output = 'Wrote ' + value;

                                                                    //requestAnimationFrame(this.anim);
                                                                    this.anim();
                                                                })
                                                            }
                                                        }


                                                    }); 
                                                });
                                            })

                                            //spawn a graph based prototype hierarchy for the connection info?
                                            //e.g. to show the additional modularity off
    
                                            let c = document.getElementById(this.stream.deviceId+'console');
                                            let outputmode = document.getElementById(this.stream.deviceId+'outputmode') as HTMLInputElement;
    
                                            this.anim = () => { 
    
                                                if(outputmode.value === 'a') 
                                                    c.innerText = `${this.output}`; 
                                                else if (outputmode.value === 'b') {
                                                    c.innerText += `${this.output}\n`;
                                                    if(c.innerText.length > 20000) { //e.g 20K char limit
                                                        c.innerText = c.innerText.substring(c.innerText.length - 20000, c.innerText.length); //trim output
                                                    }
                                                }
                                            }

                                                document.getElementById(this.stream.deviceId).style.display = '';

                                                const xconnectEvent = (ev) => {
                                                    BLE.disconnect(this.stream.device).then(() => {
                                                        (self.querySelector(this.stream.deviceId+'xconnect') as HTMLButtonElement).innerHTML = 'Reconnect';
                                                        (self.querySelector(this.stream.deviceId+'xconnect') as HTMLButtonElement).onclick = (ev) => {  
                                                            BLE.reconnect(this.stream.deviceId).then((device) => {
                                                                this.output = 'Reconnected to ' + device.deviceId;
                                                                //self.render(); //re-render, will trigger oncreate again to reset this button and update the template 
                                                            })
                                                        }
                                                    });
                                                }

                                                (self.querySelector(this.stream.deviceId+'xconnect') as HTMLButtonElement).onclick = xconnectEvent;

                                                (self.querySelector(this.stream.deviceId+'x') as HTMLButtonElement).onclick = () => {
                                                    BLE.disconnect(this.stream.device);
                                                    this.delete();
                                                    document.getElementById(this.stream.deviceId+'console').remove(); //remove the adjacent output console
                                                }
                                            
                                                // (self.querySelector(this.stream.deviceId+'decoder') as HTMLInputElement).onchange = (ev) => {
                                                //     this.decoder = decoders[(self.querySelector(this.stream.deviceId+'decoder') as HTMLInputElement).value];
                                                // }
                                                
                                        }

                                    }

                                    let id = `port${Math.floor(Math.random()*1000000000000000)}`;

                                    ConnectionTemplate.addElement(`${id}-info`);
                                    let elm = document.createElement(`${id}-info`);
                                    document.getElementById('connections').appendChild(elm);
                                    
                                }); //set options in bleconfig
                            }
                        }
                    } as ElementProps,
                    'bleconfig':{
                        tagName:'div',
                        style:{
                            fontSize:'10px',
                            textAlign:'right'
                        },
                        children:{
                            'bleconfigdropdown':{
                                tagName:'button',
                                innerText:'--',
                                attributes:{
                                    onclick:(ev)=>{
                                        if(document.getElementById('bleconfigcontainer').style.display === 'none') {
                                            document.getElementById('bleconfigcontainer').style.display = '';
                                            document.getElementById('bleconfigdropdown').innerText = '--'
                                        }
                                        else {
                                            document.getElementById('bleconfigcontainer').style.display = 'none';
                                            document.getElementById('bleconfigdropdown').innerText = '++'
                                        }
                                        // console.log(ev)
                                        // let node = ev.target.node;
                                        // for(const key in node.children) {
                                        //     if(node.children[key].element) {
                                        //         if(!node.children[key].element.style.display) node.children[key].element.style.display = 'none';
                                        //         else node.children[key].element.style.display = '';
                                        //     }
                                        // }
                                    }
                                }
                            },
                            'bleconfigcontainer':{
                                tagName:'div',
                                children:{
                                    'namePrefixLabel':{
                                        tagName:'label',
                                        innerText:'BLE Device Name',
                                        children:{
                                            'namePrefix':{
                                                tagName:'input',
                                                attributes:{
                                                    type:'text',
                                                    placeholder:'e.g. ESP32',
                                                }
                                            } as ElementProps,
                                        }
                                    } as ElementProps,
                                    'ln':{template:'<br/>'},
                                    'deviceIdLabel':{
                                        tagName:'label',
                                        innerText:'BLE Device ID (direct connect)',
                                        children:{
                                            'deviceId':{
                                                tagName:'input',
                                                attributes:{
                                                    type:'text'
                                                }
                                            } as ElementProps,
                                        }
                                    } as ElementProps,
                                    'ln2':{template:'<br/>'},
                                    'serviceuuidLabel':{
                                        tagName:'label',
                                        innerText:'Primary Service UUID',
                                        children:{
                                            'serviceuuid':{
                                                tagName:'input',
                                                attributes:{
                                                    type:'text',
                                                    value:'0000CAFE-B0BA-8BAD-F00D-DEADBEEF0000'.toLowerCase(),
                                                    placeholder:'0000CAFE-B0BA-8BAD-F00D-DEADBEEF0000'.toLowerCase()
                                                }
                                            } as ElementProps,
                                        }
                                    } as ElementProps,
                                    'ln3':{template:'<br/>'},
                                    'servicesLabel':{
                                        tagName:'label',
                                        innerText:'Services Config ',
                                        children:{
                                            'services':{ //need to configure options for multiple services and multiple characteristics per service in like a table
                                                tagName:'table',
                                                style:{
                                                    border:'1px solid black',
                                                    display:'flex'
                                                },
                                                children:{
                                                }
                                            } as ElementProps
                                        }
                                    }
                                }
                            } as ElementProps,
                        } as ElementProps,
                    } as ElementProps,
                    'serialconnect':{
                        tagName:'button',
                        innerText:'USB Device',
                        oncreate:(self: HTMLElement, info?: ElementInfo)=>{
                            self.onclick = () => {

                                Serial.requestPort(
                                    (document.getElementById('usbVendorId') as HTMLInputElement).value ? parseInt((document.getElementById('usbVendorId') as HTMLInputElement).value) : undefined,
                                    (document.getElementById('usbProductId') as HTMLInputElement).value ? parseInt((document.getElementById('usbProductId') as HTMLInputElement).value) : undefined
                                ).then((port)=>{

                                    class ConnectionTemplate extends DOMElement {
                                            
                                        stream:StreamInfo;
                                        settings:any;
                                        
                                        getSettings = (port:SerialPort) => { //util function on this node
                                            let settings:any = {
                                                baudRate:(document.getElementById('baudRate') as HTMLInputElement).value ? parseInt((document.getElementById('baudRate') as HTMLInputElement).value) : 115200, //https://lucidar.me/en/serialib/most-used-baud-rates-table/
                                                bufferSize:(document.getElementById('bufferSize') as HTMLInputElement).value ? parseInt((document.getElementById('bufferSize') as HTMLInputElement).value) : 255,
                                                parity:(document.getElementById('parity') as HTMLInputElement).value ? (document.getElementById('parity') as HTMLInputElement).value as ParityType : 'none',
                                                dataBits:(document.getElementById('dataBits') as HTMLInputElement).value ? parseInt((document.getElementById('dataBits') as HTMLInputElement).value) : 8,
                                                stopBits:(document.getElementById('stopBits') as HTMLInputElement).value ? parseInt((document.getElementById('stopBits') as HTMLInputElement).value) : 1,
                                                flowControl:(document.getElementById('flowControl') as HTMLInputElement).value ? (document.getElementById('flowControl') as HTMLInputElement).value as FlowControlType : 'none',
                                                onconnect:(ev)=>{ console.log('connected! ', JSON.stringify(port.getInfo())); },
                                                ondisconnect:(ev)=>{ console.log('disconnected! ', JSON.stringify(port.getInfo())); },
                                                decoder:'raw' //default
                                            }

                                            return settings;
                                        }


                                        constructor() {
                                            super(); 

                                            this.settings = this.getSettings(port);

                                            this.stream = Serial.createStream({
                                                port,
                                                frequency:1,
                                                ondata:(data:ArrayBuffer)=>{
                                                    //pass to console
                                                    this.stream.output = decoders[this.settings.decoder](data);
                                                    
                                                    //requestAnimationFrame(this.settings.anim); //throttles animations to refresh rate
                                                    if(this.settings.anim) this.settings.anim();
                                                    //roughly...
                                                    //decoderworker.request({route:'decode',args:data},[data]).then((value) => {document.getElementById('console').innerText = `${value}`;} )
                                                }
                                            });
        
                                        };

                                        template = ()=>{ return `
                                            <div id='${this.stream._id}' style='display:none;'>
                                                Serial Connection
                                                <div>
                                                    <span>USB Vendor ID:</span><span>${this.stream.info.usbVendorId}</span><span>USB Product ID:</span><span>${this.stream.info.usbProductId}</span>
                                                </div>
                                                <table id='${this.stream._id}info'>
                                                    <tr><th>Baud Rate</th><th>Buffer Size</th><th>Parity</th><th>Data Bits</th><th>Stop Bits</th><th>Flow Control</th></tr>
                                                    <tr><td>${this.stream.settings.baudRate}</td><td>${this.stream.settings.bufferSize}</td><td>${this.stream.settings.parity}</td><td>${this.stream.settings.dataBits}</td><td>${this.stream.settings.stopBits}</td><td>${this.stream.settings.flowControl}</td></tr>
                                                </table>
                                                <div>
                                                    <button id='${this.stream._id}xconnect'>Disconnect</button>
                                                    <button id='${this.stream._id}x'>Remove</button>
                                                </div>
                                                <div>
                                                    <label>
                                                        Decoder:
                                                        <select id='${this.stream._id}decoder'>
                                                            ${Object.keys(decoders).map((d,i) => `<option value='${d}' ${i === 0 ? 'selected' : ''}>${d.toUpperCase()}</option>`).join('')}
                                                        </select>
                                                    </label>
                                                    <label>
                                                        Output Mode: <br/>
                                                        <select id='${this.stream._id}outputmode'>
                                                            <option value='b' selected> All </option>
                                                            <option value='a'> Latest </option>
                                                        </select>
                                                    </label>
                                                </div>
                                                <div id='${this.stream._id}console' style='color:white; background-color:black; font-size:10px; font-family:Consolas,monaco,monospace; overflow-y:scroll;'>
                                                </div>
                                            </div>`;
                                        }

                                        oncreate = (self:DOMElement,props:any) => {

                                            //spawn a graph based prototype hierarchy for the connection info?
                                            //e.g. to show the additional modularity off
    
                                            let c = document.getElementById(this.stream._id+'console');
                                            let outputmode = document.getElementById(this.stream._id+'outputmode') as HTMLInputElement;
    
                                            this.settings.anim = () => { 
    
                                                if(outputmode.value === 'a') 
                                                    c.innerText = `${this.stream.output}`; 
                                                else if (outputmode.value === 'b') {
                                                    c.innerText += `${this.stream.output}\n`;
                                                    if(c.innerText.length > 20000) { //e.g 20K char limit
                                                        c.innerText = c.innerText.substring(c.innerText.length - 20000, c.innerText.length); //trim output
                                                    }
                                                }
                                            }

                                            Serial.openPort(port, this.settings).then(()=>{

                                                Serial.readStream(this.stream);
                                                document.getElementById(this.stream._id).style.display = '';

                                                const xconnectEvent = (ev) => {
                                                    Serial.closeStream(this.stream).then(() => {
                                                        (self.querySelector(this.stream._id+'xconnect') as HTMLButtonElement).innerHTML = 'Reconnect';
                                                        (self.querySelector(this.stream._id+'xconnect') as HTMLButtonElement).onclick = (ev) => {
                                                            Serial.getPorts().then((ports) => { //check previously permitted ports for auto reconnect
                                                                for(let i = 0; i<ports.length; i++) {
                                                                    if(ports[i].getInfo().usbVendorId === this.stream.info.usbVendorId && ports[i].getInfo().usbProductId === this.stream.info.usbProductId) {
                                                                        let settings = this.getSettings(ports[i]);
                                                                        Serial.openPort(ports[i], settings).then(()=>{
                                                                            this.stream = Serial.createStream({
                                                                                port:ports[i],
                                                                                frequency:1,
                                                                                ondata:(data:ArrayBuffer)=>{
                                                                                    //pass to console
                                                                                    this.stream.output = decoders[this.settings.decoder](data);
                                                                                    
                                                                                    requestAnimationFrame(this.settings.anim); //throttles animations to refresh rate
                                                                                    //roughly...
                                                                                    //decoderworker.request({route:'decode',args:data},[data]).then((value) => {document.getElementById('console').innerText = `${value}`;} )
                                                                                }
                                                                            });
                                                                            this.settings = settings;
                                                                            self.render(); //re-render, will trigger oncreate again to reset this button and update the template 
                                                                        });
                                                                        break;
                                                                    }
                                                                }
                                                            });
                                                        }
                                                    });
                                                }

                                                (self.querySelector(this.stream._id+'xconnect') as HTMLButtonElement).onclick = xconnectEvent;

                                                (self.querySelector(this.stream._id+'x') as HTMLButtonElement).onclick = () => {
                                                    Serial.closeStream(this.stream,()=>{
                                                        
                                                    }).catch(er=>console.error(er));
                                                    this.delete();
                                                        document.getElementById(this.stream._id+'console').remove(); //remove the adjacent output console
                                                }
                                            
                                                (self.querySelector(this.stream._id+'decoder') as HTMLInputElement).onchange = (ev) => {
                                                    this.settings.decoder = decoders[(self.querySelector(this.stream._id+'decoder') as HTMLInputElement).value];
                                                }
                                                
                                            });
                                        }

                                    }

                                    let id = `port${Math.floor(Math.random()*1000000000000000)}`;

                                    ConnectionTemplate.addElement(`${id}-info`);
                                    let elm = document.createElement(`${id}-info`);
                                    document.getElementById('connections').appendChild(elm);
                                    
                                });

    
                            }
                        }
                    } as ElementProps,
                    'serialconfig':{ //need labels
                        tagName:'div',
                        style:{
                            fontSize:'10px',
                            textAlign:'right'
                        },
                        children:{
                            'serialconfigdropdown':{
                                tagName:'button',
                                innerText:'--',
                                attributes:{
                                    onclick:(ev)=>{
                                        if(document.getElementById('serialconfigcontainer').style.display === 'none') {
                                            document.getElementById('serialconfigcontainer').style.display = '';
                                            document.getElementById('serialconfigdropdown').innerText = '--'
                                        }
                                        else {
                                            document.getElementById('serialconfigcontainer').style.display = 'none';
                                            document.getElementById('serialconfigdropdown').innerText = '++'
                                        }
                                    }
                                }
                            },
                            'serialconfigcontainer':{
                                tagName:'div',
                                children:{
                                    'baudRateLabel':{
                                        tagName:'label',
                                        innerText:'Baud Rate (bps)',
                                        children:{
                                            'baudRate':{
                                                tagName:'input',
                                                attributes:{
                                                    type:'number',
                                                    placeholder:115200,
                                                    value:115200,
                                                    min:1, //anything below 9600 is unlikely
                                                    max:10000000 //10M baud I think is highest web serial supports... might only be 921600
                                                }
                                            } as ElementProps
                                        }
                                    } as ElementProps,
                                    'ln':{template:'<br/>'},
                                    'bufferSizeLabel':{
                                        tagName:'label',
                                        innerText:'Read/Write buffer size (bytes)',
                                        children:{
                                            'bufferSize':{
                                                tagName:'input',
                                                attributes:{
                                                    type:'number',
                                                    placeholder:255,
                                                    value:255,
                                                    min:1,
                                                    max:10000000 
                                                }
                                            } as ElementProps,
                                        }
                                    } as ElementProps,
                                    'ln2':{template:'<br/>'},
                                    'parityLabel':{
                                        tagName:'label',
                                        innerText:'Parity',
                                        children:{
                                            'parity':{
                                                tagName:'select',
                                                children:{
                                                    'none':{
                                                        tagName:'option',
                                                        attributes:{
                                                            value:'none',
                                                            selected:true,
                                                            innerText:'none'
                                                        }
                                                    },
                                                    'even':{
                                                        tagName:'option',
                                                        attributes:{
                                                            value:'even',
                                                            innerText:'even'
                                                        }
                                                    },
                                                    'odd':{
                                                        tagName:'option',
                                                        attributes:{
                                                            value:'odd',
                                                            innerText:'odd'
                                                        }
                                                    }
                                                }
                                            } as ElementProps,
                                        }
                                    } as ElementProps,
                                    'ln3':{template:'<br/>'},
                                    'dataBitsLabel':{
                                        tagName:'label',
                                        innerText:'Data bits (7 or 8)',
                                        children:{
                                            'dataBits':{
                                                tagName:'input',
                                                attributes:{
                                                    type:'number',
                                                    placeholder:8,
                                                    value:8,
                                                    min:7, 
                                                    max:8 
                                                }
                                            } as ElementProps,
                                        }
                                    } as ElementProps,
                                    'ln4':{template:'<br/>'},
                                    'stopBitsLabel':{
                                        tagName:'label',
                                        innerText:'Stop bits (1 or 2)',
                                        children:{
                                            'stopBits':{
                                                tagName:'input',
                                                attributes:{
                                                    type:'number',
                                                    placeholder:1,
                                                    value:1,
                                                    min:1, 
                                                    max:2 
                                                }
                                            } as ElementProps,
                                        }
                                    } as ElementProps,
                                    'ln5':{template:'<br/>'},
                                    'flowControlLabel':{
                                        tagName:'label',
                                        innerText:'Flow control (hardware?)',
                                        children:{
                                            'flowControl':{
                                                tagName:'select',
                                                children:{
                                                    'none':{
                                                        tagName:'option',
                                                        attributes:{
                                                            value:'none',
                                                            selected:true,
                                                            innerText:'none'
                                                        }
                                                    },
                                                    'hardware':{
                                                        tagName:'option',
                                                        attributes:{
                                                            value:'hardware',
                                                            innerText:'hardware'
                                                        }
                                                    },
                                                }
                                            } as ElementProps,
                                        }
                                    } as ElementProps,
                                    'ln6':{template:'<br/>'},
                                    'usbVendorIdLabel':{
                                        tagName:'label',
                                        innerText:'Vendor ID Filter? (hexadecimal)',
                                        children:{
                                            'usbVendorId':{
                                                tagName:'input',
                                                attributes:{
                                                    type:'text',
                                                    placeholder:'0xabcd',
                                                }
                                            } as ElementProps,
                                        }
                                    } as ElementProps,
                                    'ln7':{template:'<br/>'},
                                    'usbProductIdLabel':{
                                        tagName:'label',
                                        innerText:'Product ID Filter? (hexadecimal)',
                                        children:{
                                            'usbProductId':{
                                                tagName:'input',
                                                attributes:{
                                                    type:'text',
                                                    placeholder:'0xefgh',
                                                }
                                            } as ElementProps,
                                        }
                                    } as ElementProps,
                                    'ln8':{template:'<br/>'},
                                    'frequencyLabel':{
                                        tagName:'label',
                                        innerText:'Read frequency? (ms)',
                                        children:{
                                            'frequency':{
                                                tagName:'input',
                                                attributes:{
                                                    type:'number',
                                                    placeholder:10,
                                                    value:10,
                                                    min:0.001,
                                                    max:10000000,
                                                    step:0.001
                                                }
                                            } as ElementProps
                                        }
                                    } as ElementProps
                                }
                            } as ElementProps
                        }
                    } as ElementProps
                }
            } as ElementProps,
            'connections':{
                tagName:'div',
                style:{
                    height:'300px',
                    display:'flex'
                }
            }
        }
    } as DOMElementProps
};



const router = new Router([
    workers,
    proxyWorkerRoutes, 
    workerCanvasRoutes,
    new DOMService({routes:domtree})
]);


console.log(router)