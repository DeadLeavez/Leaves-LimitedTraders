import { DependencyContainer } from "tsyringe";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { IPreAkiLoadMod } from "@spt-aki/models/external/IPreAkiLoadMod"
import { OnUpdateModService } from "@spt-aki/services/mod/onUpdate/OnUpdateModService"

import { VFS } from "@spt-aki/utils/VFS";
import { jsonc } from "jsonc";
import * as path from "path";
import { LogTextColor } from "@spt-aki/models/spt/logging/LogTextColor";
import { Item } from "@spt-aki/models/eft/common/tables/IItem";
import { ITemplateItem } from "@spt-aki/models/eft/common/tables/ITemplateItem";
import { IBarterScheme, ITraderAssort } from "@spt-aki/models/eft/common/tables/ITrader";

class LimitedTraders implements IPostDBLoadMod, IPreAkiLoadMod
{
    private logger: ILogger;
    private db: DatabaseServer;

    //Config
    private config: Config;
    private vfs: VFS;

    private static moneyIDs =
        [
            "5449016a4bdc2d6f028b456f",
            "569668774bdc2da2298b4568",
            "5696686a4bdc2da3298b456a"
        ];

    //Trader update
    private setUpCompleted: boolean;
    private tradersToUpdate: string[];
    private tradersLastUpdate: number[];

    private updateTraders( timeSinceLastRun: number, logger: ILogger ): boolean
    {
        if ( timeSinceLastRun > 30 )
        {
            const tables = this.db.getTables();
            if ( !this.setUpCompleted )
            {
                return false;
            }
            let timeNow = this.getTimeNow();
            const traders = tables.traders;
            for ( let traderNum = 0; traderNum < this.tradersToUpdate.length; traderNum++ )
            {
                if ( timeNow > this.tradersLastUpdate[ traderNum ] )
                {
                    this.modifyTrader( this.tradersToUpdate[ traderNum ] );

                    this.tradersLastUpdate[ traderNum ] = structuredClone( traders[ this.tradersToUpdate[ traderNum ] ].base.nextResupply );
                    this.printColor( "[Limited Traders] Updating Trader:" + this.tradersToUpdate[ traderNum ], LogTextColor.BLUE );
                }
            }
            return true;
        }
        return false;
    }

    private getTimeNow()
    {
        const time: Date = new Date();
        const unixNow = time.valueOf();
        return Math.round( unixNow / 1000 );
    }

    public preAkiLoad( container: DependencyContainer ): void
    {

        this.vfs = container.resolve<VFS>( "VFS" );
        const configFile = path.resolve( __dirname, "../config/config.jsonc" );
        this.config = jsonc.parse( this.vfs.readFile( configFile ) );

        // Get the logger from the server container.
        this.logger = container.resolve<ILogger>( "WinstonLogger" );
        // Get database from server.
        this.db = container.resolve<DatabaseServer>( "DatabaseServer" );


        const onUpdateModService = container.resolve<OnUpdateModService>( "OnUpdateModService" );

        onUpdateModService.registerOnUpdate(
            "LimitedTradersUpdateTraders",
            ( timeSinceLastRun: number ) => this.updateTraders( timeSinceLastRun, this.logger ),
            () => "LimitedTradersUpdateTraders" // new route name
        )
    }

    public postDBLoad( container: DependencyContainer ): void 
    {
        // Get tables from database
        let tables = this.db.getTables();
        // Get item database from tables
        const itemDB = tables.templates.items;

        this.printColor( "[Limited Traders] Limited Traders Starting" );

        const traderIDs: string[] = this.config.tradersToLimit;
        const traders = this.db.getTables().traders;
        this.tradersToUpdate = [];
        this.tradersLastUpdate = [];

        for ( let traderID of traderIDs )
        {
            //Check if trader exists
            if ( !traders[ traderID ] )
            {
                continue;
            }

            this.tradersToUpdate.push( traderID );
            this.tradersLastUpdate.push( 0 );
        }

        this.setUpCompleted = true;
    }

    private modifyTrader( traderID: string ): void
    {
        const itemDB = this.db.getTables().templates.items;
        const traders = this.db.getTables().traders;

        if ( !traders[ traderID ].assort.items )
        {
            this.printColor( `Trader:${ traderID } does not  have an assort.`, LogTextColor.RED );
        }

        for ( const item of traders[ traderID ].assort.items )
        {
            if ( item.parentId != "hideout" )
            {
                continue;
            }

            let count = 0;

            //check for invalid data
            if ( !itemDB[ item._tpl ] )
            {
                //Item doesnt exist in the global item database
                this.printColor( "[Limited Traders] Found trade with item that doesnt exist in the global database. This is most likely caused by a mod doing something wrong.", LogTextColor.RED );
                this.printColor( "[Limited Traders] Item ID of broken trade is: " + item._tpl, LogTextColor.RED );
                continue;
            }
            else if ( !itemDB[ item._tpl ]._parent )
            {
                //Item exists but has no parent. 
                this.printColor( "[Limited Traders] Found trade with item in the global database that has an invalid _parent entry. This is most likely caused by a mod doing something wrong.", LogTextColor.RED );
                this.printColor( "[Limited Traders] Item ID of broken item is: " + item._tpl, LogTextColor.RED );
                continue;
            }


            //Check config categories
            count = this.getCount( itemDB, item );
            this.adjustPrice( itemDB, item, traders[ traderID ].assort.barter_scheme[ item._id ], traders[ traderID ].assort );

            item.upd.StackObjectsCount = count;

            //fix "a lot" message
            if ( item.upd.UnlimitedCount )
            {
                item.upd.UnlimitedCount = false;
            }

            if ( this.config.removeMaxBuyRestrictions )
            {
                //remove purchase limit
                if ( item.upd.BuyRestrictionMax )
                {
                    delete item.upd.BuyRestrictionMax;
                }
                if ( item.upd.BuyRestrictionCurrent )
                {
                    delete item.upd.BuyRestrictionCurrent;
                }
            }

            //Loyalty stuff
            if ( this.config.loyaltyMixup )
            {
                this.loyaltyMixup( traders, traderID, item );
            }
        }
    }
    private adjustPrice( itemDB: any, item: Item, scheme: IBarterScheme[][], assort: ITraderAssort )
    {
        const parent = itemDB[ item._tpl ]._parent;
        if ( !this.config.categories[ parent ] || !this.config.categories[ parent ].priceAdjustment )
        {
            return;
        }

        if ( this.isMoneyTrade( assort, item ) )
        {
            const priceAdjustment = this.config.categories[ parent ].priceAdjustment;
            scheme[ 0 ][ 0 ].count *= priceAdjustment;
        }
    }

    private isMoneyTrade( assort: ITraderAssort, trade: Item ): boolean
    {
        //There are no trades that are bigger than one item that is a money trade.
        if ( assort.barter_scheme[ trade._id ][ 0 ].length > 1 )
        {
            return false;
        }
        for ( const ID of LimitedTraders.moneyIDs )
        {
            if ( assort.barter_scheme[ trade._id ][ 0 ][ 0 ]._tpl == ID )
            {
                return true;
            }
        }
        return false;
    }

    private loyaltyMixup( traders: any, traderID: string, item: Item )
    {
        const loyalty = traders[ traderID ].assort.loyal_level_items;

        //Down one
        if ( loyalty[ item._id ] > 1 )
        {
            if ( Math.random() <= this.config.loyaltyMixupChance2 )
            {
                loyalty[ item._id ] -= 1;
            }
        }

        //Down two
        if ( loyalty[ item._id ] > 2 )
        {
            if ( Math.random() <= this.config.loyaltyMixupChance3 )
            {
                loyalty[ item._id ] -= 1;
            }
        }

        //Down three
        if ( loyalty[ item._id ] > 3 )
        {
            if ( Math.random() <= this.config.loyaltyMixupChance4 )
            {
                loyalty[ item._id ] -= 1;
            }
        }
    }

    private getCount( itemDB: any, item: Item ): number
    {
        const noStockRoll = Math.random();

        // Use category if it exists.
        if ( this.config.categories[ itemDB[ item._tpl ]._parent ] )
        {
            const category = this.config.categories[ itemDB[ item._tpl ]._parent ];

            // Roll for no stock.
            if ( noStockRoll < category.chanceForNoStock )
            {
                return 0;
            }

            return this.randomCount( category.base, category.random );
        }

        if ( noStockRoll > this.config.defaultChanceForNoStock )
        {
            return this.randomCount( this.config.defaultBase, this.config.defaultRandom );
        }

        return 0;
    }

    private randomCount( base: number, random: number ): number
    {
        return ( base + Math.floor( Math.random() * random * 2 ) - random )
    }

    private printColor( message: string, color: LogTextColor = LogTextColor.GREEN )
    {
        this.logger.logWithColor( message, color );
    }
}

module.exports = { mod: new LimitedTraders() }