import { DependencyContainer, inject } from "tsyringe";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { LogTextColor } from "@spt/models/spt/logging/LogTextColor";
import { DatabaseServer } from "@spt/servers/DatabaseServer";
import { JsonUtil } from "@spt/utils/JsonUtil";
import { VFS } from "./VFS";
import { randomInt } from "crypto";
import { jsonc } from "jsonc";
import { WeightedRandomHelper } from "@spt/helpers/WeightedRandomHelper";
import { IItem } from "@spt/models/eft/common/tables/IItem";

export class LeavesUtils
{
    private modFolder: string;
    private tierList: any;
    private itemTiers: number[];
    private debug: boolean;

    private databaseServer: DatabaseServer;
    private vfs: VFS;
    private jsonUtil: JsonUtil;
    private logger: ILogger;
    private weightedRandomHelper: WeightedRandomHelper;


    constructor( container: DependencyContainer )
    {
        this.vfs = new VFS();
        this.modFolder = this.vfs.resolve( `../` );

        this.databaseServer = container.resolve<DatabaseServer>( "DatabaseServer" );
        this.jsonUtil = container.resolve<JsonUtil>( "JsonUtil" );
        this.logger = container.resolve<ILogger>( "WinstonLogger" );
        this.weightedRandomHelper = container.resolve<WeightedRandomHelper>( "WeightedRandomHelper" );

        this.debug = false;
    }


    public setModFolder( folder: string )
    {
        this.modFolder = folder;
    }

    public setDebug( enabled: boolean )
    {
        this.debug = enabled;
    }

    public setTierList( file: string )
    {
        this.tierList = this.loadFile( file );
        const itemDB = this.databaseServer.getTables().templates.items;

        //Verify
        for ( let tier in this.tierList )
        {
            let currentTier: string[] = this.tierList[ tier ];
            for ( let item of Object.values( currentTier ) )
            {
                if ( !itemDB[ item ] )
                {
                    this.printColor( `[Questrandomizer]Found broken item in tierlist: ${ item } Ignore this in 3.9.x` );
                    currentTier.splice( currentTier.indexOf( item ), 1 );
                }
            }
        }

        this.generateItemTiers();
    }

    public loadFile( file: string ): any
    {
        return jsonc.parse( this.vfs.readFile( this.modFolder + file ) );
    }
    public saveFile( data: any, file: string, serialize: boolean = true )
    {
        let dataCopy = structuredClone( data );

        if ( serialize )
        {
            dataCopy = this.jsonUtil.serialize( data, true );
        }

        this.vfs.writeFile( `${ this.modFolder }${ file }`, dataCopy );
    }

    public getFoldersInFolder( folder: string ): string[]
    {
        return this.vfs.getDirs( this.modFolder + folder );
    }

    public getFilesInFolder( folder: string ): string[]
    {
        return this.vfs.getFiles( this.modFolder + folder );
    }

    public getFileWithoutExtension( file: string ): string
    {
        return this.vfs.stripExtension( file );
    }


    public checkIfFileExists( file: string ): boolean
    {
        return this.vfs.exists( this.modFolder + file )
    }

    public doesQuestExist( questID: string )
    {
        if ( this.databaseServer.getTables().templates.quests[ questID ] )
        {
            return true;
        }
        return false;
    }

    public getTraderNickname( id: string ): string
    {
        let name = "";
        try
        {
            name = this.databaseServer.getTables().traders[ id ].base.nickname ?? "Invalid ID"; 3
        } catch ( error )
        {
            this.printColor( `[Questrandomizer] Found *VERY* broken trader:${ id }. Consider contact the author of the trader and yell at them. XD`, LogTextColor.RED, false );
            name = "ERROR";
        }
        return name;
    }

    public dataDump()
    {
        const questDB = this.databaseServer.getTables().templates.quests;
        let questList = "";
        for ( const quest in questDB )
        {
            questList += `"${ quest }", //${ questDB[ quest ].QuestName }\n`;
        }
        this.saveFile( questList, "debug/quests.jsonc", false );


        let target = {};
        this.printColor( "Starting dump of items" );
        for ( let item in this.databaseServer.getTables().templates.items )
        {
            const type = this.databaseServer.getTables().templates.items[ item ]._type;
            try
            {
                if ( type === "Item" )
                {
                    this.add( item, target );
                }
            }
            catch ( e )
            {
                this.debugJsonOutput( target );
                return;
            }
        }
        let serialized: string = this.jsonUtil.serialize( target, true );
        let lines: string[] = serialized.split( `\n` )
        let processed: string = "";
        for ( const line of lines )
        {
            processed += line;
            if ( line.indexOf( "\"" ) !== -1 )
            {
                const ID: string = this.getStringBetweenChars( line, "\"", "\"" );
                let locale = this.getLocale( "en", ID, " Name" );
                if ( locale === undefined )
                {
                    locale = this.databaseServer.getTables().templates.items[ ID ]._name;
                }
                processed += " //" + locale;
            }
            processed += "\n";
        }
        this.saveFile( processed, "debug/allItems.jsonc", false );

    }

    public getLocale( locale: string, id: string, type: string = "" ): string
    {
        let localeDB;
        if ( this.databaseServer.getTables().locales.global[ locale ] )
        {
            localeDB = this.databaseServer.getTables().locales.global[ locale ];
        }
        else
        {
            localeDB = this.databaseServer.getTables().locales.global[ "en" ];
        }

        if ( !localeDB[ `${ id }${ type }` ] )
        {
            localeDB = this.databaseServer.getTables().locales.global[ "en" ];
        }

        return localeDB[ `${ id }${ type }` ];
    }
    public getStringBetweenChars( original: string, char1: string, char2: string )
    {
        return original.substring(
            original.indexOf( char1 ) + 1,
            original.lastIndexOf( char2 )
        );
    }

    public printColor( message: string, color: LogTextColor = LogTextColor.GREEN, debug = false )
    {
        if ( debug === true && this.debug === false )
        {
            return;
        }
        this.logger.log( message, color );
    }

    public debugJsonOutput( jsonObject: any, label: string = "" )
    {
        if ( label.length > 0 )
        {
            this.logger.logWithColor( "[" + label + "]", LogTextColor.GREEN );
        }
        this.logger.logWithColor( JSON.stringify( jsonObject, null, 4 ), LogTextColor.MAGENTA );
    }

    //Uses set to guarantee unique values.
    public getUniqueValues<T>( array: T[], count: number ): T[]
    {
        if ( count > array.length )
        {
            count = array.length;
        }

        let generatedValues = new Set<T>();

        while ( generatedValues.size < count )
        {
            generatedValues.add( array[ randomInt( array.length ) ] );
        }

        return Array.from( generatedValues.values() );
    }

    public getUniqueWeightedValues<T>( weightedArray: any, count: number ): T[]
    {
        if ( count > Object.keys( weightedArray ).length )
        {
            count = Object.keys( weightedArray ).length;
        }

        let generatedValues = new Set<T>();

        while ( generatedValues.size < count )
        {
            generatedValues.add( this.weightedRandomHelper.getWeightedValue( weightedArray ) );
        }

        return Array.from( generatedValues.values() );
    }

    public generateValueAdjustment( previousValue: number, factors: number[] ): number
    {
        const multiplier = 1 + ( Math.random() * factors[ 0 ] - Math.random() * factors[ 1 ] );
        const newValue = Math.round( previousValue * multiplier );
        if ( newValue < 1 )
        {
            return 1;
        }
        return newValue;
    }

    public searchObject( stringToFind: string, object: any )
    {
        //Hackiest shit ever
        if ( this.jsonUtil.serialize( object ).search( `${ stringToFind }` ) > -1 )
        {
            return true;
        }
        return false;
    }

    //Tier related stuff
    public getClosestTier( currentTier: number )
    {
        let closestDistance: number = Number.MAX_SAFE_INTEGER;
        let closestTier: number = Number.MAX_SAFE_INTEGER;
        for ( const tier of this.itemTiers )
        {
            const tempDistance = Math.abs( currentTier - tier );
            if ( tempDistance < closestDistance )
            {
                closestDistance = tempDistance;
                closestTier = tier;
            }
        }
        return closestTier;
    }
    public getRandomItemFromTier( tier: number ): string
    {
        if ( !this.tierList[ tier ] )
        {
            tier = this.getClosestTier( tier );
        }

        let size = this.tierList[ tier ].length;

        return this.tierList[ tier ][ randomInt( size ) ];
    }
    public getTierFromID( item: string ): number
    {
        for ( const tier in this.tierList )
        {
            if ( tier.includes( item ) )
            {
                return Number( tier );
            }
        }
        return -1;
    }

    private generateItemTiers()
    {
        this.itemTiers = [];
        for ( const tier in this.tierList )
        {
            this.itemTiers.push( Number( tier ) );
        }
    }
    public isProperItem( item: string ): boolean
    {
        const itemDB = this.databaseServer.getTables().templates.items;

        //Does it even exist?
        if ( !itemDB[ item ] )
        {
            return false;
        }
        const itemObject = itemDB[ item ];
        //Does is it a type of item even?
        if ( itemObject._type !== "Item" )
        {
            return false;
        }
        //Does it have props?
        if ( !itemObject._props )
        {
            return false;
        }
        //Is it a quest item?
        if ( itemObject._props.QuestItem )
        {
            return false;
        }
        return true;
    }

    public RTT_Underline( original: string ): string
    {
        return `<underline>${ original }</underline>`;
    }
    public RTT_Rotate( original: string, angle: number ): string
    {
        return `<rotate="${ angle }">${ original }</rotate>`;
    }
    public RTT_Align( original: string, alignment: string ): string
    {
        return `<align="${ alignment }">${ original }<align>`;
    }
    public RTT_Bold( original: string ): string
    {
        return `<b>${ original }</b>`;
    }
    public RTT_Italic( original: string ): string
    {
        return `<i>${ original }</i>`;
    }
    public RTT_Color( original: string, color: string ): string
    {
        if ( color.length === 0 )
        {
            return original;
        }
        if ( color.at( 0 ) === `#` )
        {
            return `<color=${ color }>${ original }</color>`;
        }
        else
        {
            return `<color="${ color }">${ original }</color>`;
        }
    }
    public RTT_Rainbowify( original: string ): string
    {
        let newString = "";
        const step = 1 / original.length;
        let start = 0;
        for ( let char of original )
        {
            let color = this.HSVtoRGB( start, 1, 1 );
            let hexstring = `#${ color.r.toString( 16 ).padStart( 2, `0` ) }${ color.g.toString( 16 ).padStart( 2, `0` ) }${ color.b.toString( 16 ).padStart( 2, `0` ) }`;
            newString += this.RTT_Color( char, hexstring );
            start += step;
        }
        return newString;
    }
    public RTT_TFify( original: string ): string
    {
        let newString = "";
        let step = 0;
        for ( let char of original )
        {
            const color = this.TFifyColor( step, original.length );
            let hexstring = `#${ color.r.toString( 16 ).padStart( 2, `0` ) }${ color.g.toString( 16 ).padStart( 2, `0` ) }${ color.b.toString( 16 ).padStart( 2, `0` ) }`;
            newString += this.RTT_Color( char, hexstring );
            step++;
        }
        return newString;
    }
    private TFifyColor( step, length ): any
    {
        let colorb =
        {
            r: 91,
            g: 206,
            b: 250
        };
        let colorp =
        {
            r: 245,
            g: 169,
            b: 184
        };
        let colorw =
        {
            r: 255,
            g: 255,
            b: 255
        };

        if ( step / length <= 0.2 )
            return colorb;
        if ( step / length > 0.2 && step / length <= 0.4 )
            return colorp;
        if ( step / length > 0.4 && step / length <= 0.6 )
            return colorw;
        if ( step / length > 0.6 && step / length <= 0.8 )
            return colorp;
        if ( step / length > 0.8 )
            return colorb;

        return colorp;
    }
    public RTT_Size( original: string, size: string ): string
    {
        return `<size=${ size }>${ original }</size>`;
    }
    /*
    https://stackoverflow.com/questions/17242144/javascript-convert-hsb-hsv-color-to-rgb-accurately
    */
    public HSVtoRGB( h, s, v )
    {
        var r, g, b, i, f, p, q, t;
        if ( arguments.length === 1 )
        {
            s = h.s, v = h.v, h = h.h;
        }
        i = Math.floor( h * 6 );
        f = h * 6 - i;
        p = v * ( 1 - s );
        q = v * ( 1 - f * s );
        t = v * ( 1 - ( 1 - f ) * s );
        switch ( i % 6 )
        {
            case 0: r = v, g = t, b = p; break;
            case 1: r = q, g = v, b = p; break;
            case 2: r = p, g = v, b = t; break;
            case 3: r = p, g = q, b = v; break;
            case 4: r = t, g = p, b = v; break;
            case 5: r = v, g = p, b = q; break;
        }
        return {
            r: Math.round( r * 255 ),
            g: Math.round( g * 255 ),
            b: Math.round( b * 255 )
        };
    }

    public hasParent( item: IItem, parent: string ): boolean
    {
        let current = item.parentId;

        while ( current !== "" )
        {
            current = this.databaseServer.getTables().templates.items[ current ]._parent;
            if ( current === parent )
            {
                return true;
            }
            if ( current === "" )
            {
                return false;
            }
        }
        return false;
    }

    public getParents( itemID: string ): string[]
    {
        let current = itemID;
        let parents: string[] = [];

        while ( current !== "" )
        {
            current = this.databaseServer.getTables().templates.items[ current ]._parent;
            if ( current === "" )
            {
                return parents;
            }
            parents.push( current );
        }
        return [];
    }

    private add( item: string, target: any )
    {
        let order: string[] = [];
        let current = item;
        const finalParent = this.databaseServer.getTables().templates.items[ item ]._parent;

        //Generate order
        do
        {
            current = this.databaseServer.getTables().templates.items[ current ]._parent;
            if ( current === "" )
            {
                break;
            }
            order.unshift( current );
        } while ( current != "" );

        //Re-generate the stack
        let tempTarget = target;
        for ( const toCheck of order )
        {
            if ( toCheck === finalParent )
            {
                if ( !tempTarget[ toCheck ] )
                {
                    tempTarget[ toCheck ] = {};
                }
                tempTarget[ toCheck ][ item ] = true;//`${ this.getLocale( "en", item, " Name" ) }`;
            }
            if ( !tempTarget[ toCheck ] )
            {
                tempTarget[ toCheck ] = {};
            }

            tempTarget = tempTarget[ toCheck ];
        }
    }

    public getBaseDBPLocation(): DBPLocation
    {
        return {
            "coordinates": { "x": 0, "y": 0, "z": 0 },
            "label": "",
            "text": "",
            "labelColor": { "r": 1.0, "g": 1.0, "b": 1.0, "a": 1.0 },
            "textColor": { "r": 1.0, "g": 1.0, "b": 1.0, "a": 1.0 },
            "objectColor": { "r": 1.0, "g": 1.0, "b": 1.0, "a": 0.35 },
            "objectType": "sphere",
            "objectScale": { "x": 0.085, "y": 0.085, "z": 0.085 },
            "physics": false
        }
    }
}

export class DBPLocations
{
    locations: Map<string, DBPLocation[]>;    
}

export interface DBPLocation
{
    coordinates: UnityVector3,
    label: string,
    text: string,
    labelColor: UnityColor,
    textColor: UnityColor,
    objectColor: UnityColor,
    objectType: string,
    objectScale: UnityVector3,
    physics: boolean
}

export interface UnityColor
{
    r: number,
    g: number,
    b: number,
    a: number
}
export interface UnityVector3
{
    x: number,
    y: number,
    z: number
}

export const RTT_Align =
{
    LEFT: "left",
    CENTER: "center",
    RIGHT: "right",
    JUSTIFIED: "justified",
    FLUSH: "flush"
};
export const RTT_Colors =
{
    BLACK: "black",
    BLUE: "blue",
    GREEN: "green",
    ORANGE: "orange",
    PURPLE: "purple",
    RED: "red",
    WHITE: "white"
};